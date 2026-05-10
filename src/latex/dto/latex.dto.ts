import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ValidateLatexDto {
  @ApiProperty({ description: 'Full LaTeX file content to validate' })
  @IsString()
  @MinLength(10)
  tex!: string;
}

export class CompileLatexDto {
  @ApiProperty({ description: 'Full LaTeX file content to compile' })
  @IsString()
  @MinLength(10)
  tex!: string;

  @ApiPropertyOptional({ description: 'Output filename (default: cv-{date}.pdf)' })
  @IsOptional()
  @IsString()
  filename?: string;
}

export type InjectStrategy = 'skills' | 'ai';

export class InjectKeywordsDto {
  @ApiProperty({ description: 'Current LaTeX source.' })
  @IsString()
  @MinLength(10)
  tex!: string;

  @ApiProperty({
    description: 'Keywords to inject. Each entry must be a short string.',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  keywords!: string[];

  @ApiPropertyOptional({
    enum: ['skills', 'ai'],
    default: 'skills',
    description:
      "'skills' (default, deterministic Technical Skills merge) or 'ai' (Gemini patch list, validate-or-rollback).",
  })
  @IsOptional()
  @IsIn(['skills', 'ai'])
  strategy?: InjectStrategy;
}
