import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';

const SEP = '═'.repeat(57);

export interface EvalResult {
  reportMarkdown: string;
  score: number | null;
  company: string | null;
  role: string | null;
  archetype: string | null;
  legitimacy: string | null;
}

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);

  // backend/src/gemini → up 3 levels → career-ops/
  private readonly projectRoot = path.resolve(__dirname, '../../');

  constructor(private readonly config: ConfigService) {}

  private get apiKey(): string {
    return this.config.get<string>('GEMINI_API_KEY') ?? '';
  }

  private get modelName(): string {
    return this.config.get<string>('GEMINI_MODEL') ?? 'gemini-2.5-pro';
  }

  private readFileSafe(relPath: string, label: string): string {
    const full = path.resolve(this.projectRoot, relPath);
    if (!existsSync(full)) {
      this.logger.warn(`${label} not found at ${full}`);
      return `[${label} not found — skipping]`;
    }
    return readFileSync(full, 'utf-8').trim();
  }

  private parseSummary(text: string): Omit<EvalResult, 'reportMarkdown'> {
    const match = text.match(/---SCORE_SUMMARY---([\s\S]*?)---END_SUMMARY---/);
    if (!match)
      return { score: null, company: null, role: null, archetype: null, legitimacy: null };

    const block = match[1];
    const get = (key: string): string | null => {
      const m = block.match(new RegExp(`${key}:\\s*(.+)`));
      return m ? m[1].trim() : null;
    };

    const scoreRaw = get('SCORE');
    const scoreNum = scoreRaw !== null ? parseFloat(scoreRaw) : NaN;
    return {
      score: isFinite(scoreNum) ? scoreNum : null,
      company: get('COMPANY'),
      role: get('ROLE'),
      archetype: get('ARCHETYPE'),
      legitimacy: get('LEGITIMACY'),
    };
  }

  async evaluateJd(
    jdText: string,
    cvOverride?: string | null,
  ): Promise<EvalResult> {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is not set. Add it to the root .env file.');
    }

    const sharedContext = this.readFileSafe('modes/_shared.md', '_shared.md');
    const ofertaLogic = this.readFileSafe('modes/oferta.md', 'oferta.md');
    const profileCtx = existsSync(path.resolve(this.projectRoot, 'modes/_profile.md'))
      ? this.readFileSafe('modes/_profile.md', '_profile.md')
      : '';
    const cvContent = cvOverride ?? this.readFileSafe('cv.md', 'cv.md');

    const systemPrompt = [
      'You are career-ops, an AI-powered job search assistant.',
      "You evaluate job offers against the user's CV using a structured A-G scoring system.",
      'Your evaluation methodology is defined below. Follow it exactly.',
      '',
      SEP, 'SYSTEM CONTEXT (_shared.md)', SEP,
      sharedContext, '',
      ...(profileCtx ? [SEP, 'USER PROFILE (_profile.md)', SEP, profileCtx, ''] : []),
      SEP, 'EVALUATION MODE (oferta.md)', SEP,
      ofertaLogic, '',
      SEP, 'CANDIDATE RESUME (cv.md)', SEP,
      cvContent, '',
      SEP, 'IMPORTANT OPERATING RULES', SEP,
      '1. You do NOT have access to WebSearch, Playwright, or file writing tools.',
      '   - Block D: provide salary estimates from training data, clearly noted as estimates.',
      '   - Block G: analyse the JD text only; skip URL/page freshness checks.',
      '2. Generate Blocks A through G in full, in English, unless the JD is in another language.',
      '3. At the very end, output this EXACT machine-readable block:',
      '',
      '---SCORE_SUMMARY---',
      'COMPANY: <company name or "Unknown">',
      'ROLE: <role title>',
      'SCORE: <global score as decimal, e.g. 3.8>',
      'ARCHETYPE: <detected archetype>',
      'LEGITIMACY: <High Confidence | Proceed with Caution | Suspicious>',
      '---END_SUMMARY---',
    ].join('\n');

    this.logger.log(`Calling ${this.modelName} — JD: ${jdText.length} chars`);

    const genAI = new GoogleGenerativeAI(this.apiKey);
    const model = genAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
    });

    const result = await model.generateContent([
      { text: systemPrompt },
      { text: `\n\nJOB DESCRIPTION TO EVALUATE:\n\n${jdText}` },
    ]);

    const reportMarkdown = result.response.text();
    const parsed = this.parseSummary(reportMarkdown);

    this.logger.log(
      `Done — score: ${parsed.score ?? 'n/a'}  company: ${parsed.company ?? '?'}`,
    );

    return { reportMarkdown, ...parsed };
  }
}
