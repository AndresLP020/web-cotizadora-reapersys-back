import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import mongoose, { type Connection, type Types } from 'mongoose';
import { ORDER_PHOTOS_BUCKET, PRODUCT_IMAGES_BUCKET } from './digital.constants';
import { domainOf, downloadImage, fetchPreviewMeta, IMAGE_TYPES, LinkPreviewError, MAX_IMAGE_BYTES, sniffImageType } from './link-preview';
import type { LinkPreview, StoredImage } from './schemas/link-preview.schema';

export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname?: string;
}

/** Resultado de la lectura de la vista previa para el formulario del panel (sin guardar nada). */
export interface LinkPreviewResult {
  title: string | null;
  description: string | null;
  siteName: string | null;
  domain: string;
  /** data: URL de la imagen (solo para mostrarla en el panel; al guardar se descarga a GridFS). */
  image: string | null;
  favicon: string | null;
  fetchedAt: Date;
}

type Bucket = typeof PRODUCT_IMAGES_BUCKET | typeof ORDER_PHOTOS_BUCKET;

export function messageOf(error: unknown): string {
  return error instanceof LinkPreviewError ? error.message : 'No se pudo leer la vista previa.';
}

/** Ruta de la demo (sin dominio) para la barra de vista previa del link. */
export function demoPathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || '/';
  } catch {
    return '';
  }
}

/**
 * Imágenes de los productos digitales en GridFS (portadas, íconos y caras de las tarjetas, públicas)
 * y fotos de los pedidos (privadas). Nunca se enlazan imágenes de otros sitios.
 */
@Injectable()
export class ProductImagesService {
  private readonly logger = new Logger(ProductImagesService.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  private bucket(name: Bucket) {
    return new mongoose.mongo.GridFSBucket(this.connection.db!, { bucketName: name });
  }

  async store(content: Buffer, contentType: string, filename: string, bucket: Bucket = PRODUCT_IMAGES_BUCKET): Promise<StoredImage> {
    const stream = this.bucket(bucket).openUploadStream(filename, { metadata: { contentType } });
    await new Promise<void>((resolve, reject) => {
      stream.once('finish', () => resolve());
      stream.once('error', reject);
      stream.end(content);
    });
    return { fileId: stream.id, contentType };
  }

  async read(fileId: Types.ObjectId, bucket: Bucket = PRODUCT_IMAGES_BUCKET): Promise<Buffer> {
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of this.bucket(bucket).openDownloadStream(fileId)) chunks.push(chunk as Buffer);
    } catch {
      throw new NotFoundException('Imagen no encontrada.');
    }
    return Buffer.concat(chunks);
  }

  async remove(fileIds: (Types.ObjectId | undefined | null)[], bucket: Bucket = PRODUCT_IMAGES_BUCKET): Promise<void> {
    for (const fileId of fileIds) if (fileId) await this.bucket(bucket).delete(fileId).catch(() => undefined);
  }

  /** Valida una imagen subida desde el panel (tipo por sus bytes, 3 MB) y la guarda. */
  async storeUpload(file: UploadedImage | undefined, filename: string): Promise<StoredImage> {
    if (!file) throw new BadRequestException('Adjunta una imagen.');
    if (file.size > MAX_IMAGE_BYTES) throw new BadRequestException('La imagen no debe pasar de 3 MB.');
    const contentType = sniffImageType(file.buffer);
    if (!contentType || !IMAGE_TYPES.includes(contentType)) throw new BadRequestException('La imagen debe ser PNG, JPEG, WebP o GIF.');
    return this.store(file.buffer, contentType, filename);
  }

  /**
   * Lee la vista previa de la demo y descarga su imagen e ícono a GridFS.
   * Devuelve la vista previa nueva y los archivos que dejaron de usarse (borrarlos después de guardar).
   * Una portada subida desde el panel tiene prioridad sobre la imagen de la página.
   * Si la lectura falla, se conserva la vista previa anterior con el motivo del error.
   */
  async readPreview(url: string, current: LinkPreview | undefined, slug: string): Promise<{ preview: LinkPreview; obsolete: Types.ObjectId[] }> {
    const now = new Date();
    const keepsUpload = current?.imageSource === 'upload' && current.image;
    if (!url) {
      // Sin demo: solo se conserva la portada subida.
      const obsolete = [keepsUpload ? null : current?.image?.fileId, current?.favicon?.fileId].filter(Boolean) as Types.ObjectId[];
      return { preview: keepsUpload ? { image: current.image, imageSource: 'upload' } : {}, obsolete };
    }
    try {
      const meta = await fetchPreviewMeta(url);
      const preview: LinkPreview = { title: meta.title, description: meta.description, siteName: meta.siteName, domain: meta.domain, fetchedAt: now };
      const obsolete: Types.ObjectId[] = [];
      if (keepsUpload) {
        preview.image = current.image;
        preview.imageSource = 'upload';
      } else {
        if (current?.image) obsolete.push(current.image.fileId);
        if (meta.imageUrl) {
          try {
            const image = await downloadImage(meta.imageUrl, 'image');
            preview.image = await this.store(image.content, image.contentType, `${slug}-og`);
            preview.imageSource = 'og';
          } catch (error) {
            preview.error = `Imagen: ${messageOf(error)}`;
          }
        } else {
          preview.error = 'La página no trae imagen de vista previa: sube una portada.';
        }
      }
      if (current?.favicon) obsolete.push(current.favicon.fileId);
      if (meta.faviconUrl) {
        const favicon = await downloadImage(meta.faviconUrl, 'favicon').catch(() => null);
        if (favicon) preview.favicon = await this.store(favicon.content, favicon.contentType, `${slug}-favicon`);
      }
      return { preview, obsolete };
    } catch (error) {
      this.logger.warn(`Vista previa de ${slug}: ${messageOf(error)}`);
      return { preview: { ...(current ?? {}), domain: current?.domain ?? domainOf(url), fetchedAt: now, error: messageOf(error) }, obsolete: [] };
    }
  }

  /** Vista previa para el formulario del panel, sin guardar nada (imagen e ícono como data: URL). */
  async previewOnce(url: string): Promise<LinkPreviewResult> {
    let meta;
    try {
      meta = await fetchPreviewMeta(url);
    } catch (error) {
      throw new BadRequestException(messageOf(error));
    }
    const asDataUrl = async (src: string | undefined, kind: 'image' | 'favicon') => {
      if (!src) return null;
      const image = await downloadImage(src, kind).catch(() => null);
      return image ? `data:${image.contentType};base64,${image.content.toString('base64')}` : null;
    };
    const [image, favicon] = await Promise.all([asDataUrl(meta.imageUrl, 'image'), asDataUrl(meta.faviconUrl, 'favicon')]);
    return {
      title: meta.title ?? null,
      description: meta.description ?? null,
      siteName: meta.siteName ?? null,
      domain: meta.domain,
      image,
      favicon,
      fetchedAt: new Date(),
    };
  }
}

/** Ruta pública (en la API) de una imagen; el id del archivo invalida la caché del navegador. */
export function assetPath(base: string, asset: string, image: StoredImage | undefined | null): string | null {
  return image ? `${base}/${asset}?v=${image.fileId.toString()}` : null;
}

