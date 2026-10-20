import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, StreamableFile } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiGoneResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AccessTokenParam, CreateQuoteDto, PreviewQuoteDto } from './dto/quote.dto';
import { QuotesService } from './quotes.service';

@ApiTags('Público')
@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Calcula una cotización con los precios vigentes. No persiste nada.' })
  @ApiOkResponse({ description: 'PublicCalculation' })
  @ApiBadRequestResponse({ description: 'Selección inválida.' })
  preview(@Body() dto: PreviewQuoteDto) {
    return this.quotes.preview(dto.selection);
  }

  @Post()
  @Throttle({ default: { limit: 10, ttl: 10 * 60_000 } })
  @ApiOperation({ summary: 'Registra una solicitud de cotización con folio y devuelve un enlace de consulta.' })
  @ApiCreatedResponse({ description: 'CreateQuoteResult (el token de acceso se entrega una sola vez).' })
  @ApiUnprocessableEntityResponse({ description: 'Componentes incompatibles sin solicitud de valoración.' })
  create(@Body() dto: CreateQuoteDto) {
    return this.quotes.create(dto);
  }

  @Get('access/:token')
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Consulta pública de una cotización mediante su enlace seguro.' })
  @ApiGoneResponse({ description: 'Enlace vencido.' })
  getByToken(@Param() params: AccessTokenParam) {
    return this.quotes.getByAccessToken(params.token);
  }

  @Get('access/:token/pdf')
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'PDF de la versión vigente de la cotización.' })
  @ApiGoneResponse({ description: 'Enlace vencido.' })
  async pdf(@Param() params: AccessTokenParam): Promise<StreamableFile> {
    const pdf = await this.quotes.getPdfByAccessToken(params.token);
    return new StreamableFile(pdf.content, { type: 'application/pdf', disposition: `inline; filename="${pdf.filename}"`, length: pdf.content.length });
  }
}
