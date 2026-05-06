import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export class PatchProfileDto {
  @ApiProperty({ description: 'Profile data as a JSON object' })
  @IsObject()
  data!: Record<string, unknown>;
}
