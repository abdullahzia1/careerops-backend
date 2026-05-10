import { IsOptional, IsString, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ExtractJdDto {
  @ApiPropertyOptional({
    description:
      'Public URL of a Greenhouse, Ashby, or Lever job posting. Either `url` or `text` is required.',
  })
  @IsOptional()
  @IsString()
  url?: string;

  @ApiPropertyOptional({
    description:
      'Pre-extracted JD text. Use this when the URL is unsupported (LinkedIn, Indeed, etc.).',
  })
  @IsOptional()
  @IsString()
  text?: string;
}

export class ExtractKeywordsDto {
  @ApiPropertyOptional({ description: 'JD text from `/jd/extract`.' })
  @IsString()
  @MinLength(40)
  jdText!: string;

  @ApiPropertyOptional({
    description: 'Current CV / LaTeX source for the missingFromCv comparison.',
  })
  @IsOptional()
  @IsString()
  cv?: string;
}
