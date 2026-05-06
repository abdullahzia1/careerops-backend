import { Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { TrackerService } from './tracker.service';

@ApiTags('tracker')
@Controller('tracker')
export class TrackerController {
  constructor(private readonly trackerService: TrackerService) {}

  @Get('verify')
  @ApiOperation({ summary: 'Verify pipeline integrity — canonical statuses, no dupes, report files present' })
  verify() {
    return this.trackerService.verify();
  }

  @Post('normalize')
  @ApiOperation({ summary: 'Normalize all non-canonical statuses in applications.md to English canonicals' })
  @ApiQuery({ name: 'dryRun', required: false, type: Boolean })
  normalize(@Query('dryRun') dryRun?: string) {
    return this.trackerService.normalize(dryRun === 'true');
  }

  @Post('dedup')
  @ApiOperation({ summary: 'Remove duplicate company+role entries, keeping highest-scoring row' })
  @ApiQuery({ name: 'dryRun', required: false, type: Boolean })
  dedup(@Query('dryRun') dryRun?: string) {
    return this.trackerService.dedup(dryRun === 'true');
  }

  @Post('merge')
  @ApiOperation({ summary: 'Merge TSV additions from batch/tracker-additions/ into applications.md' })
  @ApiQuery({ name: 'dryRun', required: false, type: Boolean })
  merge(@Query('dryRun') dryRun?: string) {
    return this.trackerService.merge(dryRun === 'true');
  }
}
