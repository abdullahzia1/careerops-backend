import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateEvaluationDto {
  @ApiPropertyOptional({ description: 'Full job description text' })
  @IsOptional()
  @IsString()
  jdText?: string;

  @ApiPropertyOptional({ description: 'URL to the job posting (alternative to jdText)' })
  @IsOptional()
  @IsString()
  sourceUrl?: string;

  @ApiPropertyOptional({ description: 'CV version ID to use (defaults to active)' })
  @IsOptional()
  @IsString()
  cvVersionId?: string;

  @ApiPropertyOptional({ description: 'Profile snapshot ID to use (defaults to active)' })
  @IsOptional()
  @IsString()
  profileSnapshotId?: string;
}
