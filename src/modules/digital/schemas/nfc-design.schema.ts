import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HEX_COLOR, PRODUCT_STATUSES, type ProductStatus, SLUG_PATTERN } from '../digital.constants';
import { LinkPreview, LinkPreviewSchema, StoredImage, StoredImageSchema } from './link-preview.schema';

/** Colores de la tarjeta (card/line/ink/muted/accent) y de su página de contacto (accent/btn). */
@Schema({ _id: false })
export class NfcColors {
  @Prop({ required: true, match: HEX_COLOR }) card!: string;
  @Prop({ required: true, match: HEX_COLOR }) line!: string;
  @Prop({ required: true, match: HEX_COLOR }) ink!: string;
  @Prop({ required: true, match: HEX_COLOR }) muted!: string;
  @Prop({ required: true, match: HEX_COLOR }) accent!: string;
  @Prop({ required: true, match: HEX_COLOR }) onAccent!: string;
  @Prop({ required: true, match: HEX_COLOR }) btn!: string;
  @Prop({ required: true, match: HEX_COLOR }) onBtn!: string;
}
const NfcColorsSchema = SchemaFactory.createForClass(NfcColors);

export const DEFAULT_NFC_COLORS: NfcColors = {
  card: '#0A0D16',
  line: '#1E2433',
  ink: '#F5F7FB',
  muted: '#A9B1C6',
  accent: '#7DD3FC',
  onAccent: '#06212F',
  btn: '#0A0F1E',
  onBtn: '#FFFFFF',
};

/** Diseño de tarjeta NFC con su página de contacto de demostración. */
@Schema({ collection: 'nfc_designs', timestamps: true })
export class NfcDesign {
  @Prop({ required: true, unique: true, trim: true, lowercase: true, match: SLUG_PATTERN })
  slug!: string;

  @Prop({ required: true, trim: true, maxlength: 80 })
  name!: string;

  /** Página de contacto de demostración (https). Vacía = aún no se puede publicar. */
  @Prop({ trim: true, maxlength: 500, default: '' })
  demoUrl!: string;

  @Prop({ type: NfcColorsSchema, default: () => ({ ...DEFAULT_NFC_COLORS }) })
  colors!: NfcColors;

  @Prop({ type: StoredImageSchema })
  frontImage?: StoredImage;

  @Prop({ type: StoredImageSchema })
  backImage?: StoredImage;

  @Prop({ type: LinkPreviewSchema, default: () => ({}) })
  preview!: LinkPreview;

  @Prop({ required: true, enum: PRODUCT_STATUSES, default: 'draft' })
  status!: ProductStatus;

  @Prop({ default: 0 })
  sortOrder!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export const NfcDesignSchema = SchemaFactory.createForClass(NfcDesign);
NfcDesignSchema.index({ status: 1, sortOrder: 1 });
