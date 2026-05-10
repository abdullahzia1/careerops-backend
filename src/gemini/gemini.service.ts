import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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

export interface KeywordBundle {
  hardSkills: string[];
  softSkills: string[];
  tools: string[];
  certifications: string[];
  acronyms: string[];
  /** Subset of the above that is NOT already present in the supplied CV. */
  missingFromCv: string[];
}

export interface LatexPatch {
  /** Exact line / substring to replace (must occur exactly once in the input). */
  find: string;
  /** Replacement string, same shape but with weaved-in keywords. */
  replace: string;
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

  /**
   * Extract structured ATS keywords from a JD. Uses Gemini's JSON response mode
   * so the caller never has to parse loose markdown.
   */
  async extractAtsKeywords(jdText: string, cv: string): Promise<KeywordBundle> {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is not set. Add it to the root .env file.');
    }

    const genAI = new GoogleGenerativeAI(this.apiKey);
    const model = genAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    });

    const prompt = [
      'You extract ATS keywords from a job description.',
      'Return ONLY a JSON object with exactly these arrays of short strings:',
      '  hardSkills, softSkills, tools, certifications, acronyms, missingFromCv',
      'Rules:',
      '- Dedupe within each array (case-insensitive).',
      '- Keep each entry under 32 characters.',
      '- Maximum 25 entries per array; order by importance.',
      '- hardSkills: technologies, methodologies, regulations explicitly named (e.g., "TypeScript", "GDPR", "RAG").',
      '- softSkills: behavioural skills (e.g., "stakeholder management", "consultative selling").',
      '- tools: named products/SaaS/platforms (e.g., "Salesforce NPSP", "Jira", "Stripe").',
      '- certifications: explicit credentials (e.g., "AWS Solutions Architect").',
      '- acronyms: relevant acronyms exactly as written in the JD (e.g., "GDPR", "FCDO", "INGO").',
      '- missingFromCv: subset of all the above NOT already present in the CV',
      '  via case-insensitive substring match. Empty array if everything is present.',
      '',
      'CV:',
      cv || '(empty)',
      '',
      'JOB DESCRIPTION:',
      jdText,
    ].join('\n');

    this.logger.log(`Extracting keywords — JD ${jdText.length} chars, CV ${cv.length} chars`);

    const result = await model.generateContent(prompt);
    const raw = result.response.text();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.logger.warn(`Model returned non-JSON: ${raw.slice(0, 240)}`);
      throw new BadRequestException('Model returned malformed JSON.');
    }

    return this.coerceKeywordBundle(parsed);
  }

  /**
   * Ask Gemini for a list of (find, replace) patches that weave the supplied
   * keywords into existing LaTeX bullets / skills lines. The caller (LatexInjectorService.aiRewrite)
   * applies each patch with strict equality and re-validates.
   */
  async proposeLatexPatches(tex: string, keywords: string[]): Promise<LatexPatch[]> {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is not set. Add it to the root .env file.');
    }
    if (keywords.length === 0) return [];

    const genAI = new GoogleGenerativeAI(this.apiKey);
    const model = genAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    });

    const prompt = [
      'You will receive a LaTeX resume and a list of ATS keywords to weave in.',
      'Return ONLY a JSON object: { "patches": [{ "find": "...", "replace": "..." }, ...] }.',
      'Hard rules — failure to follow any rule means we discard your output:',
      '1. `find` MUST be an EXACT, contiguous substring of the resume that occurs EXACTLY ONCE.',
      '2. NEVER touch:',
      '   - Anything outside \\resumeItem{...}, \\resumeSubItem{...} bullet bodies, or the {{SKILLS}} body.',
      '   - \\section{...}, \\begin{...}, \\end{...}, custom command definitions, \\usepackage, geometry.',
      '3. NEVER introduce non-ASCII characters.',
      '4. Keep each modified bullet body under 200 characters.',
      '5. Escape LaTeX specials in any inserted keyword: & % $ # _ { } ~ ^ \\',
      '6. If a keyword would change the meaning of a bullet, SKIP it (do not force it).',
      '7. Maximum 8 patches total.',
      '',
      'KEYWORDS TO WEAVE (subset of these is fine):',
      keywords.join(', '),
      '',
      'LATEX RESUME:',
      tex,
    ].join('\n');

    const result = await model.generateContent(prompt);
    const raw = result.response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.logger.warn(`Patch model returned non-JSON: ${raw.slice(0, 240)}`);
      return [];
    }

    const root = parsed as { patches?: unknown };
    if (!Array.isArray(root.patches)) return [];

    return root.patches
      .filter(
        (p): p is LatexPatch =>
          typeof (p as LatexPatch).find === 'string' &&
          typeof (p as LatexPatch).replace === 'string' &&
          (p as LatexPatch).find.length > 0,
      )
      .slice(0, 8);
  }

  private coerceKeywordBundle(value: unknown): KeywordBundle {
    const root = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const arr = (key: string): string[] => {
      const v = root[key];
      if (!Array.isArray(v)) return [];
      return v
        .filter((x): x is string => typeof x === 'string')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length <= 64)
        .slice(0, 25);
    };
    return {
      hardSkills: arr('hardSkills'),
      softSkills: arr('softSkills'),
      tools: arr('tools'),
      certifications: arr('certifications'),
      acronyms: arr('acronyms'),
      missingFromCv: arr('missingFromCv'),
    };
  }
}
