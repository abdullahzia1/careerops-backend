import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as path from 'path';
import { HttpLoggerMiddleware } from './common/middleware/http-logger.middleware';
import { EvalWorkerModule } from './eval-worker/eval-worker.module';
import { EvaluationsModule } from './evaluations/evaluations.module';
import { FollowupsModule } from './followups/followups.module';
import { GeminiModule } from './gemini/gemini.module';
import { HealthController } from './health/health.controller';
import { JdModule } from './jd/jd.module';
import { LatexModule } from './latex/latex.module';
import { LivenessModule } from './liveness/liveness.module';
import { MeModule } from './me/me.module';
import { PatternsModule } from './patterns/patterns.module';
import { PdfModule } from './pdf/pdf.module';
import { ScanModule } from './scan/scan.module';
import { StoreModule } from './store/store.module';
import { SystemModule } from './system/system.module';
import { TrackerModule } from './tracker/tracker.module';

// Works for both ts-node (src/) and compiled (dist/) paths.
const BACKEND_ENV = path.resolve(__dirname, '../.env');

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [BACKEND_ENV],
    }),
    StoreModule,
    GeminiModule,
    EvalWorkerModule,
    MeModule,
    EvaluationsModule,
    ScanModule,
    PatternsModule,
    PdfModule,
    LivenessModule,
    FollowupsModule,
    TrackerModule,
    SystemModule,
    LatexModule,
    JdModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpLoggerMiddleware).forRoutes('*');
  }
}
