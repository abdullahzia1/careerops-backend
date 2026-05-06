import { Module } from '@nestjs/common';
import { GeminiModule } from '../gemini/gemini.module';
import { EvalWorkerService } from './eval-worker.service';

@Module({
  imports: [GeminiModule],
  providers: [EvalWorkerService],
})
export class EvalWorkerModule {}
