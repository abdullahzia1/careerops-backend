import { IsArray, IsUrl, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CheckLivenessDto {
  @ApiProperty({ type: [String], description: 'Job posting URLs to check', example: ['https://jobs.lever.co/company/abc'] })
  @IsArray()
  @ArrayMinSize(1)
  @IsUrl({}, { each: true })
  urls!: string[];
}
