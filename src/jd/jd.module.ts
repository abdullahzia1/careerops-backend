import { Module } from '@nestjs/common';
import { GeminiModule } from '../gemini/gemini.module';
import { JdController } from './jd.controller';
import { JdService } from './jd.service';

@Module({
  imports: [GeminiModule],
  controllers: [JdController],
  providers: [JdService],
  exports: [JdService],
})
export class JdModule {}
