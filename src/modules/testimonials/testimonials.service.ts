import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, Types } from 'mongoose';
import { hashIp } from '../../common/security/ip-hash';
import { AppConfigService } from '../../config/app-config.service';
import { containsText } from '../../database/query-operators';
import { actorOf, type AuthenticatedUser } from '../../security/auth.types';
import { pageOf, type Paged } from '../admin/admin.dto';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TESTIMONIAL_CONSENT_VERSION, Testimonial } from './schemas/testimonial.schema';
import type { CreateTestimonialDto, TestimonialListQuery, UpdateTestimonialDto } from './testimonials.dto';

type Doc<T> = T & { _id: Types.ObjectId };

function toPublic(t: Doc<Testimonial>) {
  return { id: t._id.toString(), name: t.name, company: t.company, role: t.role, rating: t.rating, message: t.message, createdAt: t.createdAt };
}

function toAdmin(t: Doc<Testimonial>) {
  return { ...toPublic(t), email: t.email, status: t.status, featured: t.featured, reviewedBy: t.reviewedBy, reviewedAt: t.reviewedAt };
}

@Injectable()
export class TestimonialsService {
  private readonly logger = new Logger(TestimonialsService.name);

  constructor(
    @InjectModel(Testimonial.name) private readonly testimonials: Model<Testimonial>,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  /** Comentarios aprobados (destacados primero) y la calificación promedio de todos los aprobados. */
  async listPublic(limit = 12) {
    const [items, [stats]] = await Promise.all([
      this.testimonials.find({ status: 'approved' }).sort({ featured: -1, createdAt: -1 }).limit(limit).lean<Doc<Testimonial>[]>(),
      this.testimonials.aggregate<{ count: number; average: number }>([
        { $match: { status: 'approved' } },
        { $group: { _id: null, count: { $sum: 1 }, average: { $avg: '$rating' } } },
      ]),
    ]);
    return {
      items: items.map(toPublic),
      count: stats?.count ?? 0,
      average: stats ? Math.round(stats.average * 10) / 10 : null,
    };
  }

  /** Igual que el formulario de contacto: con el honeypot lleno se responde igual pero no se guarda nada. */
  async submit(dto: CreateTestimonialDto, ip?: string): Promise<{ received: true }> {
    if (dto.website && dto.website.trim().length > 0) {
      this.logger.warn('Comentario descartado por honeypot.');
      return { received: true };
    }
    const testimonial = await this.testimonials.create({
      name: dto.name,
      company: dto.company,
      role: dto.role,
      email: dto.email,
      rating: dto.rating,
      message: dto.message,
      status: 'pending',
      consent: { textVersion: TESTIMONIAL_CONSENT_VERSION, acceptedAt: new Date() },
      ipHash: ip ? hashIp(ip, this.config.get('SESSION_SECRET')) : undefined,
    });
    await this.notifications.scheduleForNewTestimonial(testimonial._id);
    return { received: true };
  }

  async listAdmin(query: TestimonialListQuery): Promise<Paged<ReturnType<typeof toAdmin>>> {
    const { page, pageSize, skip } = pageOf(query);
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.q) filter.$or = [{ name: containsText(query.q) }, { company: containsText(query.q) }, { message: containsText(query.q) }];
    const [items, total] = await Promise.all([
      this.testimonials.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean<Doc<Testimonial>[]>(),
      this.testimonials.countDocuments(filter),
    ]);
    return { page, pageSize, total, items: items.map(toAdmin) };
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateTestimonialDto) {
    if (dto.status === undefined && dto.featured === undefined) throw new BadRequestException('No hay cambios que aplicar.');
    const before = await this.testimonials.findById(id).lean<Doc<Testimonial>>();
    if (!before) throw new NotFoundException('Comentario no encontrado.');
    const set: Record<string, unknown> = {};
    if (dto.featured !== undefined) set.featured = dto.featured;
    if (dto.status !== undefined && dto.status !== before.status) Object.assign(set, { status: dto.status, reviewedBy: user.email, reviewedAt: new Date() });
    const updated = await this.testimonials.findByIdAndUpdate(id, { $set: set }, { returnDocument: 'after' }).lean<Doc<Testimonial>>();
    await this.audit.record({
      action: 'testimonial.updated',
      entityType: 'testimonial',
      entityId: before._id,
      actor: actorOf(user),
      before: { status: before.status, featured: before.featured },
      after: { status: updated!.status, featured: updated!.featured },
    });
    return toAdmin(updated!);
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const deleted = await this.testimonials.findByIdAndDelete(id).lean<Doc<Testimonial>>();
    if (!deleted) throw new NotFoundException('Comentario no encontrado.');
    await this.audit.record({
      action: 'testimonial.deleted',
      entityType: 'testimonial',
      entityId: deleted._id,
      actor: actorOf(user),
      before: { name: deleted.name, status: deleted.status, rating: deleted.rating },
    });
  }
}
