import { BadRequestException, Injectable } from '@nestjs/common';
import { StoreService } from '../store/store.service';
import { CreateEvaluationDto } from './dto/create-evaluation.dto';

@Injectable()
export class EvaluationsService {
  constructor(private readonly store: StoreService) {}

  createJob(dto: CreateEvaluationDto) {
    const result = this.store.enqueueEvaluation({
      jdText: dto.jdText,
      sourceUrl: dto.sourceUrl,
      cvVersionId: dto.cvVersionId,
      profileSnapshotId: dto.profileSnapshotId,
    });
    if ('error' in result) throw new BadRequestException(result.error);
    return result;
  }

  listJobs() {
    return this.store.listJobs();
  }

  getJob(id: string) {
    return this.store.getJob(id);
  }
}
