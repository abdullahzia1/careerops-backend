import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JdService, JdResult } from './jd.service';
import type { KeywordBundle } from '../gemini/gemini.service';
import { ExtractJdDto, ExtractKeywordsDto } from './dto/jd.dto';

@ApiTags('jd')
@Controller('jd')
export class JdController {
  constructor(private readonly jdService: JdService) {}

  @Post('extract')
  @ApiOperation({
    summary:
      'Fetch a JD from a Greenhouse/Ashby/Lever URL, or pass through a pasted text body.',
  })
  extract(@Body() dto: ExtractJdDto): Promise<JdResult> {
    return this.jdService.extract({ url: dto.url, text: dto.text });
  }

  @Post('keywords')
  @ApiOperation({
    summary: 'Extract structured ATS keywords from a JD using Gemini.',
  })
  keywords(@Body() dto: ExtractKeywordsDto): Promise<KeywordBundle> {
    return this.jdService.extractKeywords(dto.jdText, dto.cv ?? '');
  }
}
