import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AdminRoute, CurrentUser } from '../../security/admin.guard';
import type { AuthenticatedUser } from '../../security/auth.types';
import { IdParam } from '../admin/admin.dto';
import { CreateTestimonialDto, PublicTestimonialsQuery, TestimonialListQuery, UpdateTestimonialDto } from './testimonials.dto';
import { TestimonialsService } from './testimonials.service';

@ApiTags('Público')
@Controller('testimonials')
export class PublicTestimonialsController {
  constructor(private readonly testimonials: TestimonialsService) {}

  @Get()
  @ApiOperation({ summary: 'Comentarios de clientes aprobados para mostrarse en el sitio.' })
  list(@Query() query: PublicTestimonialsQuery) {
    return this.testimonials.listPublic(query.limit ?? 12);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  // Límite estricto por IP: 5 envíos cada 10 minutos.
  @Throttle({ default: { limit: 5, ttl: 10 * 60 * 1000 } })
  @ApiOperation({ summary: 'Envía un comentario; se publica solo después de aprobarse en el panel.' })
  @ApiCreatedResponse({ description: '{ received: true }' })
  @ApiTooManyRequestsResponse({ description: 'Demasiadas solicitudes desde la misma IP.' })
  submit(@Body() dto: CreateTestimonialDto, @Req() req: Request) {
    return this.testimonials.submit(dto, req.ip);
  }
}

@Controller('admin/testimonials')
@AdminRoute('testimonials:manage')
export class TestimonialsAdminController {
  constructor(private readonly testimonials: TestimonialsService) {}

  @Get()
  list(@Query() query: TestimonialListQuery) {
    return this.testimonials.listAdmin(query);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Aprueba, rechaza o destaca un comentario.' })
  update(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam, @Body() dto: UpdateTestimonialDto) {
    return this.testimonials.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam): Promise<void> {
    await this.testimonials.remove(user, id);
  }
}
