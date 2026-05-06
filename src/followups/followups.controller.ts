import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { FollowupsService } from './followups.service';

@ApiTags('followups')
@Controller('followups')
export class FollowupsController {
  constructor(private readonly followupsService: FollowupsService) {}

  @Get()
  @ApiOperation({ summary: 'Follow-up cadence tracker — which applications need action and when' })
  @ApiQuery({ name: 'overdueOnly', required: false, type: Boolean })
  @ApiQuery({ name: 'appliedFirstDays', required: false, type: Number, description: 'Days after applying before first follow-up (default: 7)' })
  analyze(
    @Query('overdueOnly') overdueOnly?: string,
    @Query('appliedFirstDays') appliedFirstDays?: string,
  ) {
    return this.followupsService.analyze({
      overdueOnly: overdueOnly === 'true',
      appliedFirstDays: appliedFirstDays ? parseInt(appliedFirstDays, 10) : undefined,
    });
  }
}
