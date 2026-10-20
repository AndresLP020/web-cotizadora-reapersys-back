import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Types } from 'mongoose';

/** PDF generado para una versión de cotización. El archivo vive en GridFS (bucket quote_documents). */
@Schema({ collection: 'quote_documents', timestamps: { createdAt: true, updatedAt: false } })
export class QuoteDocument {
  @Prop({ type: Types.ObjectId, ref: 'Quote', required: true })
  quote!: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  version!: number;

  @Prop({ type: Types.ObjectId, required: true })
  fileId!: Types.ObjectId;

  @Prop({ required: true })
  filename!: string;

  @Prop({ required: true })
  size!: number;

  /** SHA-256 del archivo: permite verificar que el documento no se alteró. */
  @Prop({ required: true })
  sha256!: string;

  createdAt!: Date;
}

export type QuoteDocumentDocument = HydratedDocument<QuoteDocument>;
export const QuoteDocumentSchema = SchemaFactory.createForClass(QuoteDocument);
QuoteDocumentSchema.index({ quote: 1, version: 1 }, { unique: true });
