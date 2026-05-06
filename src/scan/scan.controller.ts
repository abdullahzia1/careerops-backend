import {
  Controller,
  Get,
  Post,
  Query,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ScanService, ScanResult, PortalCompany } from './scan.service';

@ApiTags('scan')
@Controller('scan')
export class ScanController {
  constructor(private readonly scanService: ScanService) {}

  @Get('portals')
  @ApiOperation({ summary: 'List all configured portal companies from portals.yml' })
  listPortals(): PortalCompany[] {
    return this.scanService.listPortals();
  }

  @Post()
  @ApiOperation({
    summary: 'Trigger a portal scan — hits Greenhouse/Ashby/Lever APIs directly, zero LLM cost',
  })
  @ApiQuery({
    name: 'company',
    required: false,
    description: 'Filter to a single company by name (partial match)',
  })
  @ApiQuery({
    name: 'dryRun',
    required: false,
    type: Boolean,
    description: 'Preview results without writing to pipeline.md or scan-history.tsv',
  })
  async scan(
    @Query('company') company?: string,
    @Query('dryRun') dryRun?: string,
  ): Promise<ScanResult> {
    try {
      return await this.scanService.scan({
        company,
        dryRun: dryRun === 'true',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new HttpException(msg, HttpStatus.BAD_REQUEST);
    }
  }
}
