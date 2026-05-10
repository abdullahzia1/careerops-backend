import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { readFileSync } from 'fs';
import { LatexService } from './latex.service';
import { ValidateLatexDto, CompileLatexDto } from './dto/latex.dto';

@ApiTags('latex')
@Controller('latex')
export class LatexController {
  constructor(private readonly latexService: LatexService) {}

  @Get('template')
  @ApiOperation({ summary: 'Return the seed cv-template.tex source for the Resume Builder editor' })
  template(): { tex: string } {
    return { tex: this.latexService.readTemplate() };
  }

  @Post('validate')
  @ApiOperation({ summary: 'Validate LaTeX CV — check structure, placeholders, brace balance' })
  validate(@Body() dto: ValidateLatexDto) {
    return this.latexService.validate(dto.tex);
  }

  @Post('compile')
  @ApiOperation({
    summary: 'Compile LaTeX to PDF via tectonic or pdflatex (must be installed on PATH)',
    description:
      'On success: streams the PDF as application/pdf with Content-Disposition: attachment. ' +
      'On failure: returns JSON { success: false, message, logSnippet? } with status 422. ' +
      'Requires tectonic (preferred) or pdflatex on the server.',
  })
  compile(
    @Body() dto: CompileLatexDto,
    @Res({ passthrough: true }) res: Response,
  ): StreamableFile | { success: false; message: string; logSnippet?: string } {
    const filename = this.latexService.sanitizeFilename(dto.filename);
    const result = this.latexService.compile(dto.tex, filename);

    if (!result.success || !result.pdfPath) {
      res.status(HttpStatus.UNPROCESSABLE_ENTITY);
      return {
        success: false,
        message: result.message,
        ...(result.logSnippet ? { logSnippet: result.logSnippet } : {}),
      };
    }

    const pdfBuffer = readFileSync(result.pdfPath);
    this.latexService.cleanupArtifacts(result.pdfPath);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length.toString());
    return new StreamableFile(pdfBuffer);
  }
}
