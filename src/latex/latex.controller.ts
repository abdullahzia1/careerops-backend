import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { LatexService } from './latex.service';
import { ValidateLatexDto, CompileLatexDto } from './dto/latex.dto';

@ApiTags('latex')
@Controller('latex')
export class LatexController {
  constructor(private readonly latexService: LatexService) {}

  @Post('validate')
  @ApiOperation({ summary: 'Validate LaTeX CV — check structure, placeholders, brace balance' })
  validate(@Body() dto: ValidateLatexDto) {
    return this.latexService.validate(dto.tex);
  }

  @Post('compile')
  @ApiOperation({
    summary: 'Compile LaTeX to PDF via tectonic or pdflatex (must be installed on PATH)',
    description: 'Returns compile result with PDF path. Requires tectonic (brew install tectonic) or pdflatex on server.',
  })
  compile(@Body() dto: CompileLatexDto) {
    const filename = dto.filename ?? `cv-${new Date().toISOString().slice(0, 10)}.pdf`;
    return this.latexService.compile(dto.tex, filename);
  }
}
