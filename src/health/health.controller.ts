import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Liveness check' })
  check(): { ok: boolean; timestamp: string } {
    return { ok: true, timestamp: new Date().toISOString() };
  }
}
