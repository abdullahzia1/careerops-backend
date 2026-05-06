import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Patch,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PatchCvDto } from './dto/patch-cv.dto';
import { PatchProfileDto } from './dto/patch-profile.dto';
import { MeService } from './me.service';

@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(private readonly meService: MeService) {}

  @Get()
  @ApiOperation({ summary: 'Get current user state (CV versions + profile snapshots)' })
  getMe() {
    return this.meService.getMe();
  }

  @Patch('cv')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save a new CV version (optimistic concurrency via If-Match)' })
  patchCv(
    @Body() dto: PatchCvDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = this.meService.patchCv(dto.content, ifMatch);
    if (!result.ok) {
      throw new HttpException('Precondition Failed', HttpStatus.PRECONDITION_FAILED);
    }
    res.setHeader('ETag', result.version.etag);
    return {
      id: result.version.id,
      etag: result.version.etag,
      createdAt: result.version.createdAt,
    };
  }

  @Patch('profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save a new profile snapshot (optimistic concurrency via If-Match)' })
  patchProfile(
    @Body() dto: PatchProfileDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = this.meService.patchProfile(dto.data, ifMatch);
    if (!result.ok) {
      throw new HttpException('Precondition Failed', HttpStatus.PRECONDITION_FAILED);
    }
    res.setHeader('ETag', result.snapshot.etag);
    return {
      id: result.snapshot.id,
      etag: result.snapshot.etag,
      createdAt: result.snapshot.createdAt,
    };
  }
}
