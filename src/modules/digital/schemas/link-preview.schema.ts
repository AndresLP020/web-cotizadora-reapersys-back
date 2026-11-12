import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

/** Imagen guardada en GridFS (nunca se enlaza la de otro sitio). */
@Schema({ _id: false })
export class StoredImage {
  @Prop({ type: Types.ObjectId, required: true })
  fileId!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 40 })
  contentType!: string;
}
export const StoredImageSchema = SchemaFactory.createForClass(StoredImage);

/** Vista previa del enlace de la demo (como la que muestra WhatsApp), leída de sus etiquetas Open Graph. */
@Schema({ _id: false })
export class LinkPreview {
  @Prop({ trim: true, maxlength: 200 })
  title?: string;

  @Prop({ trim: true, maxlength: 400 })
  description?: string;

  @Prop({ trim: true, maxlength: 120 })
  siteName?: string;

  @Prop({ trim: true, maxlength: 200 })
  domain?: string;

  /** Imagen de la vista previa: og:image descargada o portada subida desde el panel. */
  @Prop({ type: StoredImageSchema })
  image?: StoredImage;

  /** og = leída de la página; upload = portada subida desde el panel (tiene prioridad). */
  @Prop({ enum: ['og', 'upload'] })
  imageSource?: 'og' | 'upload';

  @Prop({ type: StoredImageSchema })
  favicon?: StoredImage;

  @Prop()
  fetchedAt?: Date;

  /** Motivo si la última lectura falló (el producto se guarda igual). */
  @Prop({ trim: true, maxlength: 300 })
  error?: string;
}
export const LinkPreviewSchema = SchemaFactory.createForClass(LinkPreview);
