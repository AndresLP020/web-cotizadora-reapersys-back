import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import mongoose, { type Connection, type Model, type Types } from 'mongoose';
import { Client } from '../clients/schemas/client.schema';
import { Quote } from '../quotes/schemas/quote.schema';
import { QuoteVersion } from '../quotes/schemas/quote-version.schema';
import { BusinessSettings } from '../settings/schemas/business-settings.schema';
import { renderQuotePdf } from './quote-pdf.renderer';
import { QuoteDocument } from './schemas/quote-document.schema';

type Doc<T> = T & { _id: Types.ObjectId };

export interface StoredPdf {
  filename: string;
  sha256: string;
  content: Buffer;
}

/**
 * PDFs de cotizaciones. Cada versión genera su documento UNA vez y se guarda en GridFS:
 * descargas y envíos posteriores entregan exactamente el mismo archivo (congelado con su snapshot).
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(QuoteDocument.name) private readonly documents: Model<QuoteDocument>,
    @InjectModel(Quote.name) private readonly quotes: Model<Quote>,
    @InjectModel(QuoteVersion.name) private readonly versions: Model<QuoteVersion>,
    @InjectModel(Client.name) private readonly clients: Model<Client>,
    @InjectModel(BusinessSettings.name) private readonly settings: Model<BusinessSettings>,
  ) {}

  private get bucket() {
    return new mongoose.mongo.GridFSBucket(this.connection.db!, { bucketName: 'quote_documents' });
  }

  /** PDF de la versión indicada (o la vigente). Lo genera y almacena si aún no existe. */
  async getQuotePdf(quoteId: Types.ObjectId, version?: number): Promise<StoredPdf> {
    const quote = await this.quotes.findById(quoteId).lean<Doc<Quote>>();
    if (!quote) throw new NotFoundException('Cotización no encontrada.');
    const targetVersion = version ?? quote.currentVersion;

    const existing = await this.documents.findOne({ quote: quote._id, version: targetVersion }).lean<Doc<QuoteDocument>>();
    if (existing) return { filename: existing.filename, sha256: existing.sha256, content: await this.download(existing.fileId) };

    const [snapshot, client, settings] = await Promise.all([
      this.versions.findOne({ quote: quote._id, version: targetVersion }).lean<Doc<QuoteVersion>>(),
      this.clients.findById(quote.client).lean<Doc<Client>>(),
      this.settings.findOne({ key: 'default' }).lean<BusinessSettings>(),
    ]);
    if (!snapshot || !client || !settings) throw new NotFoundException('Versión de cotización no encontrada.');

    const content = await renderQuotePdf({
      business: { tradeName: settings.tradeName, legalName: settings.legalName, email: settings.contact.email, whatsapp: settings.contact.whatsapp },
      folio: quote.folio,
      version: targetVersion,
      createdAt: snapshot.createdAt,
      // La vigencia solo aplica a la versión vigente de una cotización emitida.
      validUntil: targetVersion === quote.currentVersion ? quote.validUntil : null,
      client: { name: client.name, company: client.company, email: client.email, phone: client.phone },
      calculation: snapshot.calculation,
      terms: settings.commercialTerms,
    });
    const filename = `${quote.folio}${targetVersion > 1 ? `-v${targetVersion}` : ''}.pdf`;
    const sha256 = createHash('sha256').update(content).digest('hex');
    const fileId = await this.upload(filename, content, { quote: quote._id, version: targetVersion, sha256 });

    try {
      await this.documents.create({ quote: quote._id, version: targetVersion, fileId, filename, size: content.length, sha256 });
      return { filename, sha256, content };
    } catch (error) {
      // Dos peticiones simultáneas: gana la primera; se elimina el archivo duplicado.
      if ((error as { code?: number }).code !== 11000) throw error;
      await this.bucket.delete(fileId).catch(() => undefined);
      this.logger.debug(`PDF ${filename} ya existía (generación concurrente).`);
      return this.getQuotePdf(quoteId, targetVersion);
    }
  }

  private upload(filename: string, content: Buffer, metadata: Record<string, unknown>): Promise<Types.ObjectId> {
    return new Promise((resolve, reject) => {
      const stream = this.bucket.openUploadStream(filename, { metadata: { ...metadata, contentType: 'application/pdf' } });
      stream.once('finish', () => resolve(stream.id));
      stream.once('error', reject);
      stream.end(content);
    });
  }

  private async download(fileId: Types.ObjectId): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of this.bucket.openDownloadStream(fileId)) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }
}
