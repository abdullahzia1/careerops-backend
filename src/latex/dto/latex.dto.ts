import { IsOptional, IsString, MinLength } from 'class-validator';
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
