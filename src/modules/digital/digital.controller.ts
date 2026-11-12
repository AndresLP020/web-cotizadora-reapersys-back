import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiCreatedResponse, ApiOperation, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AdminRoute, CurrentUser, RequirePermissions } from '../../security/admin.guard';
import type { AuthenticatedUser } from '../../security/auth.types';
import { IdParam } from '../admin/admin.dto';
import { CreateDigitalOrderDto, CreateTemplateDto, PublicTemplatesQuery, SlugParam, TemplateListQuery, UpdateTemplateDto } from './digital.dto';
import { DigitalService, type UploadedImage } from './digital.service';
import { MAX_IMAGE_BYTES } from './link-preview';

@ApiTags('Público')
@Controller('digital-templates')
export class PublicDigitalController {
  constructor(private readonly digital: DigitalService) {}

  @Get()
  @ApiOperation({ summary: 'Plantillas publicadas de detalles digitales y tarjetas NFC.' })
  list(@Query() query: PublicTemplatesQuery) {
    return this.digital.listPublic(query.kind);
  }

  @Get(':slug/image')
  // El sitio vive en otro origen: sin esto, helmet (same-origin) impediría mostrar la imagen.
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  // La URL lleva el id del archivo (?v=): una imagen nueva cambia la URL, así que se puede cachear.
  @Header('Cache-Control', 'public, max-age=604800, immutable')
  @ApiOperation({ summary: 'Imagen de vista previa de la plantilla.' })
  async image(@Param() { slug }: SlugParam): Promise<StreamableFile> {
    const image = await this.digital.getImage(slug);
    return new StreamableFile(image.content, { type: image.contentType, length: image.content.length });
  }
}

@ApiTags('Público')
@Controller('digital-orders')
export class DigitalOrdersController {
  constructor(private readonly digital: DigitalService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  // Límite estricto por IP: 5 pedidos cada 10 minutos.
  @Throttle({ default: { limit: 5, ttl: 10 * 60 * 1000 } })
  @ApiOperation({ summary: 'Pide un detalle digital o tarjetas NFC; llega al panel como prospecto.' })
  @ApiCreatedResponse({ description: '{ received: true, reference }' })
  @ApiTooManyRequestsResponse({ description: 'Demasiadas solicitudes desde la misma IP.' })
  create(@Body() dto: CreateDigitalOrderDto, @Req() req: Request) {
    return this.digital.createOrder(dto, { ip: req.ip, userAgent: req.get('user-agent') });
  }
}

@Controller('admin/digital-templates')
@AdminRoute('catalog:read')
export class DigitalAdminController {
  constructor(private readonly digital: DigitalService) {}

  @Get()
  list(@Query() query: TemplateListQuery) {
    return this.digital.listAdmin(query);
  }

  @Post()
  @RequirePermissions('catalog:write')
  @ApiOperation({ summary: 'Agrega una plantilla y lee la vista previa de su demo.' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTemplateDto) {
    return this.digital.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('catalog:write')
  update(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam, @Body() dto: UpdateTemplateDto) {
    return this.digital.update(user, id, dto);
  }

  @Post(':id/refresh-preview')
  @RequirePermissions('catalog:write')
  @ApiOperation({ summary: 'Vuelve a leer la vista previa de la demo.' })
  refresh(@Param() { id }: IdParam) {
    return this.digital.refreshPreview(id);
  }

  @Post(':id/image')
  @RequirePermissions('catalog:write')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  @ApiOperation({ summary: 'Sube una captura de la plantilla (tiene prioridad sobre la imagen de la página).' })
  upload(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam, @UploadedFile() file: UploadedImage | undefined) {
    return this.digital.uploadImage(user, id, file);
  }

  @Delete(':id/image')
  @RequirePermissions('catalog:write')
  removeImage(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam) {
    return this.digital.removeUploadedImage(user, id);
  }

  @Delete(':id')
  @RequirePermissions('catalog:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam): Promise<void> {
    await this.digital.remove(user, id);
  }
}
