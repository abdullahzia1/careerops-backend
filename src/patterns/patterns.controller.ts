import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PatternsService, PatternsResult, PatternsError } from './patterns.service';

@ApiTags('patterns')
@Controller('patterns')
export class PatternsController {
  constructor(private readonly patternsService: PatternsService) {}

  @Get()
  @ApiOperation({
    summary: 'Analyze rejection/progression patterns across all evaluated applications',
  })
  @ApiQuery({
    name: 'minThreshold',
    required: false,
    type: Number,
    description: 'Minimum applications beyond "Evaluated" required to run analysis (default: 5)',
  })
  analyze(
    @Query('minThreshold') minThreshold?: string,
  ): PatternsResult | PatternsError {
    const threshold = minThreshold ? parseInt(minThreshold, 10) : 5;
    return this.patternsService.analyze(isNaN(threshold) ? 5 : threshold);
  }
}
