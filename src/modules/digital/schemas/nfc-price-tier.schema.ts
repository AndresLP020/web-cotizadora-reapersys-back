import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { NFC_QUANTITY_TIERS, type NfcQuantityTier } from '../digital.constants';

/** Tramo de precio de las tarjetas NFC por cantidad (1, 10, 25, 50+). */
@Schema({ collection: 'nfc_price_tiers', timestamps: true })
export class NfcPriceTier {
  @Prop({ required: true, unique: true, enum: NFC_QUANTITY_TIERS })
  quantity!: NfcQuantityTier;

  /** Precio por tarjeta en centavos. null = «Por cotizar». */
  @Prop({ type: Number, default: null, min: 0 })
  unitPriceCents!: number | null;

  /** El tramo se cotiza siempre (50+), aunque tenga precio de referencia. */
  @Prop({ default: false })
  quoteOnly!: boolean;

  createdAt!: Date;
  updatedAt!: Date;
}

export const NfcPriceTierSchema = SchemaFactory.createForClass(NfcPriceTier);
