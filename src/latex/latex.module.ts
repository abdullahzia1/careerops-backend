import { Module } from '@nestjs/common';
import { GeminiModule } from '../gemini/gemini.module';
import { LatexController } from './latex.controller';
import { LatexService } from './latex.service';
import { LatexInjectorService } from './latex-injector.service';

@Module({
  imports: [GeminiModule],
  controllers: [LatexController],
  providers: [LatexService, LatexInjectorService],
  exports: [LatexService, LatexInjectorService],
})
export class LatexModule {}
