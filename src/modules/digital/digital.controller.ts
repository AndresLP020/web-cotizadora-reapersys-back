import {
  BadRequestException,
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
  Put,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCreatedResponse, ApiOperation, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Request } from 'express';
import { AdminRoute, CurrentUser, RequirePermissions } from '../../security/admin.guard';
import type { AuthenticatedUser } from '../../security/auth.types';
import { IdParam } from '../admin/admin.dto';
import { MAX_ORDER_PHOTO_BYTES, MAX_ORDER_PHOTOS } from './digital.constants';
import {
  CreateDigitalOrderDto,
  CreateNfcDesignDto,
  CreateOccasionDto,
  CreateTemplateDto,
  LinkPreviewRequestDto,
  NfcAssetParam,
  OrderListQuery,
  OrderPhotoParam,
  ProductListQuery,
  PublicTemplatesQuery,
  TemplateAssetParam,
  UpdateDigitalOrderDto,
  UpdateNfcDesignDto,
  UpdateNfcPricingDto,
  UpdateOccasionDto,
  UpdateTemplateDto,
} from './digital.dto';
import { DigitalOrdersService } from './digital-orders.service';
import { DigitalService } from './digital.service';
import { MAX_IMAGE_BYTES } from './link-preview';
import { NfcService } from './nfc.service';
import { ProductImagesService, type UploadedImage } from './product-images.service';

const imageFile = (content: { content: Buffer; contentType: string }) =>
  new StreamableFile(content.content, { type: content.contentType, length: content.content.length });

// ====================================================================== público

@ApiTags('Público')
@Controller('digital-templates')
export class PublicDigitalController {
  constructor(private readonly digital: DigitalService) {}

  @Get()
  @ApiOperation({ summary: 'Plantillas publicadas de detalles digitales (filtro opcional por ocasión).' })
  list(@Query() query: PublicTemplatesQuery) {
    return this.digital.listPublic(query.ocasion);
  }

  @Get(':slug/:asset')
  // El sitio puede vivir en otro origen: sin esto, helmet (same-origin) impediría mostrar la imagen.
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  // La URL lleva el id del archivo (?v=): una imagen nueva cambia la URL, así que se puede cachear.
  @Header('Cache-Control', 'public, max-age=604800, immutable')
  @ApiOperation({ summary: 'Imagen (image) o ícono (favicon) de la vista previa de la plantilla.' })
  async asset(@Param() { slug, asset }: TemplateAssetParam): Promise<StreamableFile> {
    return imageFile(await this.digital.getAsset(slug, asset));
  }
}

@ApiTags('Público')
@Controller('occasions')
export class PublicOccasionsController {
  constructor(private readonly digital: DigitalService) {}

  @Get()
  @ApiOperation({ summary: 'Ocasiones de los detalles digitales, en orden.' })
  list() {
    return this.digital.listOccasions();
  }
}

@ApiTags('Público')
@Controller()
export class PublicNfcController {
  constructor(private readonly nfc: NfcService) {}

  @Get('nfc-designs')
  @ApiOperation({ summary: 'Diseños publicados de tarjetas NFC.' })
  designs() {
    return this.nfc.listPublic();
  }

  @Get('nfc-designs/:slug/:asset')
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  @Header('Cache-Control', 'public, max-age=604800, immutable')
  @ApiOperation({ summary: 'Imagen del diseño: preview, favicon, front o back.' })
  async asset(@Param() { slug, asset }: NfcAssetParam): Promise<StreamableFile> {
    return imageFile(await this.nfc.getAsset(slug, asset));
  }

  @Get('nfc-pricing')
  @ApiOperation({ summary: 'Precio por tarjeta según la cantidad (1, 10, 25, 50+). null = «Por cotizar».' })
  pricing() {
    return this.nfc.pricing();
  }
}

@ApiTags('Público')
@Controller('digital-orders')
export class DigitalOrdersController {
  constructor(private readonly orders: DigitalOrdersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  // Límite estricto por IP: 5 pedidos cada 10 minutos.
  @Throttle({ default: { limit: 5, ttl: 10 * 60 * 1000 } })
  @UseInterceptors(
    FilesInterceptor('photos', MAX_ORDER_PHOTOS, { limits: { fileSize: MAX_ORDER_PHOTO_BYTES, files: MAX_ORDER_PHOTOS, fields: 2, fieldSize: 20_000 } }),
  )
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ description: 'multipart: `payload` (JSON de CreateDigitalOrderDto) y hasta 6 `photos`; o el JSON directo sin fotos.' })
  @ApiOperation({ summary: 'Pide un detalle digital o tarjetas NFC; llega al panel como prospecto. No se cobra en línea.' })
  @ApiCreatedResponse({ description: '{ received: true, reference }' })
  @ApiTooManyRequestsResponse({ description: 'Demasiadas solicitudes desde la misma IP.' })
  async create(@Body() body: Record<string, unknown>, @UploadedFiles() files: UploadedImage[] | undefined, @Req() req: Request) {
    const dto = await parseOrder(body);
    return this.orders.create(dto, files ?? [], { ip: req.ip, userAgent: req.get('user-agent') });
  }
}

/** El pedido llega como JSON o, con fotos, como multipart con el JSON en `payload`. */
async function parseOrder(body: Record<string, unknown>): Promise<CreateDigitalOrderDto> {
  let raw: unknown = body;
  if (typeof body.payload === 'string') {
    try {
      raw = JSON.parse(body.payload);
    } catch {
      throw new BadRequestException('El pedido no es válido.');
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('El pedido no es válido.');
  const dto = plainToInstance(CreateDigitalOrderDto, raw);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length > 0) throw new BadRequestException(errors.flatMap((e) => Object.values(e.constraints ?? {})));
  return dto;
}

// ====================================================================== panel

@Controller('admin/digital-templates')
@AdminRoute('catalog:read')
export class DigitalAdminController {
  constructor(private readonly digital: DigitalService) {}

  @Get()
  list(@Query() query: ProductListQuery) {
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

  @Get(':id/assets/:asset')
  @Header('Cache-Control', 'private, max-age=3600')
  // Solo el mismo sitio (el panel); helmet pone same-origin y en local el panel usa otro puerto.
  @Header('Cross-Origin-Resource-Policy', 'same-site')
  async asset(@Param() { id }: IdParam, @Param('asset') asset: string): Promise<StreamableFile> {
    if (asset !== 'image' && asset !== 'favicon') throw new BadRequestException('Imagen no válida.');
    return imageFile(await this.digital.getAdminAsset(id, asset));
  }

  @Post(':id/image')
  @RequirePermissions('catalog:write')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  @ApiOperation({ summary: 'Sube una portada (reemplaza a la imagen de la página en la vista previa).' })
  upload(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam, @UploadedFile() file: UploadedImage | undefined) {
    return this.digital.uploadCover(user, id, file);
  }

  @Delete(':id/image')
  @RequirePermissions('catalog:write')
  removeImage(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam) {
    return this.digital.removeCover(user, id);
  }

  @Delete(':id')
  @RequirePermissions('catalog:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam): Promise<void> {
    await this.digital.remove(user, id);
  }
}

@Controller('admin/occasions')
@AdminRoute('catalog:read')
export class OccasionsAdminController {
  constructor(private readonly digital: DigitalService) {}

  @Get()
  list() {
    return this.digital.listOccasionsAdmin();
  }

  @Post()
  @RequirePermissions('catalog:write')
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOccasionDto) {
    await this.digital.createOccasion(user, dto);
    return this.digital.listOccasionsAdmin();
  }

  @Patch(':id')
  @RequirePermissions('catalog:write')
  async update(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam, @Body() dto: UpdateOccasionDto) {
    await this.digital.updateOccasion(user, id, dto);
    return this.digital.listOccasionsAdmin();
  }

  @Delete(':id')
  @RequirePermissions('catalog:write')
  async remove(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam) {
    await this.digital.removeOccasion(user, id);
    return this.digital.listOccasionsAdmin();
  }
}

@Controller('admin/nfc-designs')
@AdminRoute('catalog:read')
export class NfcDesignsAdminController {
  constructor(private readonly nfc: NfcService) {}

  @Get()
  list(@Query() query: ProductListQuery) {
    return this.nfc.listAdmin(query);
  }

  @Post()
  @RequirePermissions('catalog:write')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateNfcDesignDto) {
    return this.nfc.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('catalog:write')
  update(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam, @Body() dto: UpdateNfcDesignDto) {
    return this.nfc.update(user, id, dto);
  }

  @Post(':id/refresh-preview')
  @RequirePermissions('catalog:write')
  refresh(@Param() { id }: IdParam) {
    return this.nfc.refreshPreview(id);
  }

  @Get(':id/assets/:asset')
  @Header('Cache-Control', 'private, max-age=3600')
  // Solo el mismo sitio (el panel); helmet pone same-origin y en local el panel usa otro puerto.
  @Header('Cross-Origin-Resource-Policy', 'same-site')
  async asset(@Param() { id }: IdParam, @Param('asset') asset: string): Promise<StreamableFile> {
    if (asset !== 'preview' && asset !== 'favicon' && asset !== 'front' && asset !== 'back') throw new BadRequestException('Imagen no válida.');
    return imageFile(await this.nfc.getAdminAsset(id, asset));
  }

  @Post(':id/images/:which')
  @RequirePermissions('catalog:write')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  @ApiOperation({ summary: 'Sube la portada del link (preview) o la imagen del frente o reverso de la tarjeta.' })
  upload(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam, @Param('which') which: string, @UploadedFile() file: UploadedImage | undefined) {
    return this.nfc.uploadImage(user, id, imageSlot(which), file);
  }

  @Delete(':id/images/:which')
  @RequirePermissions('catalog:write')
  removeImage(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam, @Param('which') which: string) {
    return this.nfc.removeImage(user, id, imageSlot(which));
  }

  @Delete(':id')
  @RequirePermissions('catalog:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam): Promise<void> {
    await this.nfc.remove(user, id);
  }
}

function imageSlot(which: string): 'preview' | 'front' | 'back' {
  if (which !== 'preview' && which !== 'front' && which !== 'back') throw new BadRequestException('Imagen no válida.');
  return which;
}

@Controller('admin/nfc-pricing')
@AdminRoute('catalog:read')
export class NfcPricingAdminController {
  constructor(private readonly nfc: NfcService) {}

  @Get()
  get() {
    return this.nfc.pricing();
  }

  @Put()
  @RequirePermissions('catalog:write')
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateNfcPricingDto) {
    return this.nfc.updatePricing(user, dto);
  }
}

@Controller('admin/link-preview')
@AdminRoute('catalog:write')
export class LinkPreviewAdminController {
  constructor(private readonly images: ProductImagesService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60 * 1000 } })
  @ApiOperation({ summary: 'Lee la vista previa (og:title, og:description, og:image, favicon) de una URL https, sin guardar nada.' })
  read(@Body() dto: LinkPreviewRequestDto) {
    return this.images.previewOnce(dto.url);
  }
}

@Controller('admin/digital-orders')
@AdminRoute('leads:read')
export class DigitalOrdersAdminController {
  constructor(private readonly orders: DigitalOrdersService) {}

  @Get()
  list(@Query() query: OrderListQuery) {
    return this.orders.list(query);
  }

  @Patch(':id')
  @RequirePermissions('leads:write')
  update(@CurrentUser() user: AuthenticatedUser, @Param() { id }: IdParam, @Body() dto: UpdateDigitalOrderDto) {
    return this.orders.update(user, id, dto);
  }

  @Get(':id/photos/:fileId')
  @Header('Cache-Control', 'private, no-store')
  @Header('Cross-Origin-Resource-Policy', 'same-site')
  async photo(@Param() { id, fileId }: OrderPhotoParam): Promise<StreamableFile> {
    return imageFile(await this.orders.photo(id, fileId));
  }
}
