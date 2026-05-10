import { IsIn, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GeneratePdfDto {
  @ApiPropertyOptional({
    description: 'Pre-built CV HTML. If omitted, the service builds HTML from the active CV + profile.yml.',
  })
  @IsOptional()
  @IsString()
  html?: string;

  @ApiPropertyOptional({ enum: ['a4', 'letter'], default: 'a4', description: 'Page format' })
  @IsOptional()
  @IsIn(['a4', 'letter'])
  format?: 'a4' | 'letter';
}

export class PreviewCvDto {
  @ApiPropertyOptional({
    description:
      'Draft CV markdown to preview. If omitted, falls back to the active CV from the store.',
  })
  @IsOptional()
  @IsString()
  markdown?: string;
}
