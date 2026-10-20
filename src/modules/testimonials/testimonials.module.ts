import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Testimonial, TestimonialSchema } from './schemas/testimonial.schema';
import { PublicTestimonialsController, TestimonialsAdminController } from './testimonials.controller';
import { TestimonialsService } from './testimonials.service';

/** Comentarios de clientes: envío público con moderación en el panel. */
@Module({
  imports: [MongooseModule.forFeature([{ name: Testimonial.name, schema: TestimonialSchema }])],
  controllers: [PublicTestimonialsController, TestimonialsAdminController],
  providers: [TestimonialsService],
})
export class TestimonialsModule {}
