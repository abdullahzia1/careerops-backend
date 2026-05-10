import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from '../gemini/gemini.service';
import { LatexService } from './latex.service';

export interface InjectionResult {
  /** New `.tex` source. Equal to the input on no-op or rollback. */
  tex: string;
  /** Keywords actually merged in. */
  added: string[];
  /** Keywords that were already present (dedupe) or were rejected. */
  skipped: string[];
  /** Populated when AI rewrite was rolled back. */
  error?: string;
}

const DEFAULT_SEPARATOR = ' | ';

/** LaTeX special characters that must be escaped when embedded inside a body. */
const LATEX_ESCAPES: Array<[RegExp, string]> = [
  [/\\/g, '\\textbackslash{}'],
  [/&/g, '\\&'],
  [/%/g, '\\%'],
  [/\$/g, '\\$'],
  [/#/g, '\\#'],
  [/_/g, '\\_'],
  [/\{/g, '\\{'],
  [/\}/g, '\\}'],
  [/~/g, '\\textasciitilde{}'],
  [/\^/g, '\\textasciicircum{}'],
];

@Injectable()
export class LatexInjectorService {
  private readonly logger = new Logger(LatexInjectorService.name);

  constructor(
    private readonly latexService: LatexService,
    private readonly gemini: GeminiService,
  ) {}

  /**
   * Deterministic strategy: merge keywords into the Technical Skills bullet
   * inside `\section{Technical Skills}`. Cannot break compilation because we
   * only touch the inside of the existing `\item{ ... }` body.
   */
  injectIntoSkills(tex: string, keywords: string[]): InjectionResult {
    const cleaned = this.cleanList(keywords);
    if (cleaned.length === 0) {
      return { tex, added: [], skipped: [] };
    }

    const block = this.findSkillsBlock(tex);
    if (!block) {
      return {
        tex,
        added: [],
        skipped: cleaned,
        error: 'Technical Skills section not found in LaTeX source.',
      };
    }

    const separator = this.detectSeparator(block.body);
    const existing = this.tokenize(block.body, separator);
    const existingLower = new Set(existing.map((t) => t.toLowerCase()));

    const added: string[] = [];
    const skipped: string[] = [];
    for (const kw of cleaned) {
      const escaped = this.escapeForLatex(kw);
      const key = escaped.toLowerCase();
      if (existingLower.has(key) || existingLower.has(kw.toLowerCase())) {
        skipped.push(kw);
        continue;
      }
      existing.push(escaped);
      existingLower.add(key);
      added.push(kw);
    }

    if (added.length === 0) {
      return { tex, added: [], skipped };
    }

    const newBody = existing.join(separator);
    const updatedTex = tex.slice(0, block.bodyStart) + newBody + tex.slice(block.bodyEnd);

    const validation = this.latexService.validate(updatedTex);
    if (!validation.valid) {
      this.logger.warn(
        `Skills injection rolled back due to validation: ${validation.errors.join('; ')}`,
      );
      return { tex, added: [], skipped: cleaned, error: validation.errors.join('; ') };
    }

    this.logger.log(
      `Skills injection: added ${added.length}, skipped ${skipped.length}`,
    );
    return { tex: updatedTex, added, skipped };
  }

  /**
   * AI strategy: ask Gemini for a list of (find, replace) patches across
   * bullets, apply them with strict equality and a single-occurrence guard,
   * and roll back if the result fails LatexService.validate.
   */
  async aiRewrite(tex: string, keywords: string[]): Promise<InjectionResult> {
    const cleaned = this.cleanList(keywords);
    if (cleaned.length === 0) {
      return { tex, added: [], skipped: [] };
    }

    let patches;
    try {
      patches = await this.gemini.proposeLatexPatches(tex, cleaned);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        tex,
        added: [],
        skipped: cleaned,
        error: `AI rewrite call failed: ${msg}`,
      };
    }

    if (patches.length === 0) {
      return {
        tex,
        added: [],
        skipped: cleaned,
        error: 'AI returned no usable patches.',
      };
    }

    let working = tex;
    const applied: string[] = [];
    for (const patch of patches) {
      if (!patch.find || !patch.replace) continue;
      const occurrences = this.countOccurrences(working, patch.find);
      if (occurrences !== 1) {
        this.logger.warn(
          `Skipping patch — ${occurrences} occurrence(s) of find string`,
        );
        continue;
      }
      working = working.replace(patch.find, patch.replace);
      applied.push(patch.replace);
    }

    if (applied.length === 0) {
      return {
        tex,
        added: [],
        skipped: cleaned,
        error: 'No AI patches applied (no exact-match candidates).',
      };
    }

    const validation = this.latexService.validate(working);
    if (!validation.valid) {
      this.logger.warn(
        `AI rewrite rolled back: ${validation.errors.join('; ')}`,
      );
      return {
        tex,
        added: [],
        skipped: cleaned,
        error: 'AI rewrite produced invalid LaTeX. No changes applied.',
      };
    }

    // We can't reliably attribute which keyword landed in which bullet, so we
    // approximate: any keyword now present (case-insensitive substring) in the
    // working tex but NOT in the original counts as added.
    const lowerOriginal = tex.toLowerCase();
    const lowerNew = working.toLowerCase();
    const added: string[] = [];
    const skipped: string[] = [];
    for (const kw of cleaned) {
      const lower = kw.toLowerCase();
      if (!lowerOriginal.includes(lower) && lowerNew.includes(lower)) {
        added.push(kw);
      } else {
        skipped.push(kw);
      }
    }

    this.logger.log(
      `AI rewrite: ${applied.length} patch(es) applied, ${added.length} keywords surfaced.`,
    );
    return { tex: working, added, skipped };
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  /**
   * Locates the `{{SKILLS}} body` inside `\section{Technical Skills}` ...
   * `\item{ ... }`. Returns absolute string offsets of the inner body so the
   * caller can splice without disturbing the surrounding LaTeX.
   */
  private findSkillsBlock(
    tex: string,
  ): { body: string; bodyStart: number; bodyEnd: number } | null {
    // Find the section header first.
    const sectionRe = /\\section\{Technical Skills\}/i;
    const sectionMatch = sectionRe.exec(tex);
    if (!sectionMatch) return null;

    // Look for the first `\item{` after the section header.
    const after = tex.slice(sectionMatch.index);
    const itemRe = /\\item\{/g;
    const itemMatch = itemRe.exec(after);
    if (!itemMatch) return null;

    // Walk braces to find the matching closer.
    const bodyStart = sectionMatch.index + itemMatch.index + itemMatch[0].length;
    let depth = 1;
    let i = bodyStart;
    while (i < tex.length && depth > 0) {
      const ch = tex[i];
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      if (depth === 0) break;
      i++;
    }
    if (depth !== 0) return null;
    const bodyEnd = i;

    return { body: tex.slice(bodyStart, bodyEnd), bodyStart, bodyEnd };
  }

  private detectSeparator(body: string): string {
    if (body.includes(' $\\cdot$ ')) return ' $\\cdot$ ';
    if (body.includes(' | ')) return ' | ';
    if (body.includes('|')) return '|';
    if (body.includes(',')) return ', ';
    return DEFAULT_SEPARATOR;
  }

  private tokenize(body: string, separator: string): string[] {
    return body
      .split(separator)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  private cleanList(keywords: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of keywords) {
      if (typeof raw !== 'string') continue;
      const t = raw.trim();
      if (!t) continue;
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
    return out;
  }

  private escapeForLatex(text: string): string {
    let out = text;
    for (const [re, replacement] of LATEX_ESCAPES) {
      out = out.replace(re, replacement);
    }
    return out;
  }

  private countOccurrences(haystack: string, needle: string): number {
    if (!needle) return 0;
    let count = 0;
    let idx = 0;
    while ((idx = haystack.indexOf(needle, idx)) !== -1) {
      count++;
      idx += needle.length;
      if (count > 1) return count;
    }
    return count;
  }
}
