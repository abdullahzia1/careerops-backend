import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateEvaluationDto } from './dto/create-evaluation.dto';
import { EvaluationsService } from './evaluations.service';

@ApiTags('evaluations')
@Controller('evaluations')
export class EvaluationsController {
  constructor(private readonly evaluationsService: EvaluationsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Queue a new evaluation job' })
  createJob(@Body() dto: CreateEvaluationDto) {
    return this.evaluationsService.createJob(dto);
  }

  @Get('jobs')
  @ApiOperation({ summary: 'List all evaluation jobs' })
  listJobs() {
    return { items: this.evaluationsService.listJobs() };
  }

  @Get('jobs/:id')
  @ApiOperation({ summary: 'Get a single evaluation job by ID' })
  getJob(@Param('id') id: string) {
    const job = this.evaluationsService.getJob(id);
    if (!job) throw new NotFoundException(`Job ${id} not found`);
    return job;
  }
}
