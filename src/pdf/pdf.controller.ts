import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PdfService } from './pdf.service';
import { GeneratePdfDto } from './dto/generate-pdf.dto';

@ApiTags('pdf')
@Controller('pdf')
export class PdfController {
  constructor(private readonly pdfService: PdfService) {}

  @Post()
  @ApiOperation({
    summary: 'Generate an ATS-optimized PDF from the active CV',
    description:
      'Pass `html` to render pre-built HTML, or omit to auto-build from active CV + profile.yml. Returns the PDF as a binary download.',
  })
  @ApiBody({ type: GeneratePdfDto, required: false })
  @ApiResponse({ status: 201, description: 'PDF binary (application/pdf)' })
  async generate(
    @Body() dto: GeneratePdfDto = {},
    @Res() res: Response,
  ): Promise<void> {
    try {
      const format = dto.format ?? 'a4';
      const result = dto.html
        ? await this.pdfService.generateFromHtml(dto.html, format)
        : await this.pdfService.generateFromProfile(format);

      const filename = `cv-${new Date().toISOString().slice(0, 10)}.pdf`;

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': result.buffer.length,
        'X-Page-Count': String(result.pageCount),
        'X-Size-Kb': String(result.sizeKb),
        'X-ATS-Replacements': String(result.atsReplacements),
      });
      res.status(201).send(result.buffer);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new HttpException(msg, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
