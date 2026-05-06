import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { GeminiService } from '../gemini/gemini.service';
import { StoreService } from '../store/store.service';

@Injectable()
export class EvalWorkerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EvalWorkerService.name);
  private busy = false;

  constructor(
    private readonly store: StoreService,
    private readonly gemini: GeminiService,
  ) {}

  onApplicationBootstrap(): void {
    this.logger.log('Eval worker started (polling every 2 s)');
    setInterval(() => void this.tick(), 2_000);
  }

  private async tick(): Promise<void> {
    if (this.busy) return;

    const job = this.store.claimNextQueuedJob();
    if (!job) return;

    this.busy = true;
    this.store.markJobRunning(job.id);
    this.logger.log(`Starting job ${job.id}`);

    try {
      const cvContent = this.store.getActiveCvContent();
      const result = await this.gemini.evaluateJd(job.jdFull, cvContent);
      this.store.resolveJob(job.id, result);
      this.logger.log(
        `Job ${job.id} succeeded — score: ${result.score ?? 'n/a'}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Job ${job.id} failed: ${msg}`);
      this.store.failJob(job.id, msg);
    } finally {
      this.busy = false;
    }
  }
}
