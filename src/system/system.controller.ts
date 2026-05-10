import { Controller, Get, HttpException, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemService } from './system.service';

@ApiTags('system')
@Controller('system')
export class SystemController {
  constructor(private readonly systemService: SystemService) {}

  @Get('doctor')
  @ApiOperation({ summary: 'System health check — Node version, Playwright, LaTeX engine, CV, profile, fonts, directories' })
  async doctor() {
    try {
      return await this.systemService.doctor();
    } catch (err: unknown) {
      throw new HttpException(err instanceof Error ? err.message : String(err), HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('cv-sync')
  @ApiOperation({ summary: 'CV sync check — validates cv.md, profile.yml, and warns about hardcoded metrics' })
  cvSync() {
    return this.systemService.cvSync();
  }

  @Get('update/check')
  @ApiOperation({ summary: 'Check if a career-ops system update is available on GitHub' })
  async updateCheck() {
    try {
      return await this.systemService.updateCheck();
    } catch (err: unknown) {
      throw new HttpException(err instanceof Error ? err.message : String(err), HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('update/dismiss')
  @ApiOperation({ summary: 'Dismiss the current update notification' })
  updateDismiss() {
    return this.systemService.updateDismiss();
  }

  @Post('update/apply')
  @ApiOperation({ summary: 'Apply available system update via git (preserves all user data)' })
  updateApply() {
    return this.systemService.updateApply();
  }

  @Post('update/rollback')
  @ApiOperation({ summary: 'Roll back the last applied system update' })
  updateRollback() {
    return this.systemService.updateRollback();
  }
}
