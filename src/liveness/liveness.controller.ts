import { Body, Controller, HttpException, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { LivenessService } from './liveness.service';
import { CheckLivenessDto } from './dto/check-liveness.dto';

@ApiTags('liveness')
@Controller('liveness')
export class LivenessController {
  constructor(private readonly livenessService: LivenessService) {}

  @Post()
  @ApiOperation({
    summary: 'Check if job posting URLs are still active',
    description: 'Uses headless Chromium to navigate each URL and classify it as active / expired / uncertain. Requires playwright chromium installed.',
  })
  async check(@Body() dto: CheckLivenessDto) {
    try {
      return await this.livenessService.checkUrls(dto.urls);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new HttpException(msg, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
