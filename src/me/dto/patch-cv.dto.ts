import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class PatchCvDto {
  @ApiProperty({ description: 'CV content in markdown format' })
  @IsString()
  @IsNotEmpty()
  content!: string;
}
