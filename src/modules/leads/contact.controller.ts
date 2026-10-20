import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ContactReceiptDto, CreateContactDto } from './dto/create-contact.dto';
import { LeadsService } from './leads.service';

@ApiTags('Público')
@Controller('contact')
export class ContactController {
  constructor(private readonly leads: LeadsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  // Límite estricto por IP: 5 envíos cada 10 minutos.
  @Throttle({ default: { limit: 5, ttl: 10 * 60 * 1000 } })
  @ApiOperation({ summary: 'Registra una solicitud de contacto (prospecto).' })
  @ApiCreatedResponse({ type: ContactReceiptDto })
  @ApiTooManyRequestsResponse({ description: 'Demasiadas solicitudes desde la misma IP.' })
  async create(@Body() dto: CreateContactDto, @Req() req: Request): Promise<ContactReceiptDto> {
    const { reference } = await this.leads.createFromContactForm(dto, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    return { received: true, reference };
  }
}
