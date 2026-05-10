import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { GeminiService, KeywordBundle } from '../gemini/gemini.service';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_JD_LENGTH = 12_000;

export interface JdResult {
  company: string | null;
  role: string | null;
  jdText: string;
  sourceUrl: string | null;
}

interface SingleJobTarget {
  type: 'greenhouse' | 'ashby' | 'lever';
  /** API endpoint we should hit to fetch the job's JSON payload */
  apiUrl: string;
  /** Original public URL the user pasted */
  sourceUrl: string;
  /** For Ashby we POST a body with `jobId`; surface it here so the caller can attach it. */
  jobId?: string;
  /** For Ashby we need the org slug to POST against the right board */
  org?: string;
}

/**
 * Detects which ATS (if any) hosts a single job posting and returns the API
 * endpoint that exposes the JD content.
 *
 * Exported so other services (eg. ScanService) can reuse the same regexes.
 */
export function detectSingleJob(rawUrl: string): SingleJobTarget | null {
  const url = rawUrl.trim();

  // Greenhouse: https://job-boards(.eu).greenhouse.io/{org}/jobs/{id}
  // (also the older boards.greenhouse.io/{org}/jobs/{id})
  const ghMatch = url.match(
    /https?:\/\/(?:job-boards(?:\.eu)?|boards)\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i,
  );
  if (ghMatch) {
    return {
      type: 'greenhouse',
      apiUrl: `https://boards-api.greenhouse.io/v1/boards/${ghMatch[1]}/jobs/${ghMatch[2]}?content=true`,
      sourceUrl: url,
    };
  }

  // Ashby: https://jobs.ashbyhq.com/{org}/{job-id}
  const ashbyMatch = url.match(/https?:\/\/jobs\.ashbyhq\.com\/([^/?#]+)\/([^/?#]+)/i);
  if (ashbyMatch) {
    return {
      type: 'ashby',
      // Ashby's posting API supports filtering by jobId via querystring on the
      // job-board endpoint. We grab the full board and pick the matching job.
      apiUrl: `https://api.ashbyhq.com/posting-api/job-board/${ashbyMatch[1]}?includeCompensation=false`,
      sourceUrl: url,
      jobId: ashbyMatch[2],
      org: ashbyMatch[1],
    };
  }

  // Lever: https://jobs.lever.co/{org}/{job-id}
  const leverMatch = url.match(/https?:\/\/jobs\.lever\.co\/([^/?#]+)\/([^/?#]+)/i);
  if (leverMatch) {
    return {
      type: 'lever',
      apiUrl: `https://api.lever.co/v0/postings/${leverMatch[1]}/${leverMatch[2]}?mode=json`,
      sourceUrl: url,
    };
  }

  return null;
}

@Injectable()
export class JdService {
  private readonly logger = new Logger(JdService.name);

  constructor(private readonly gemini: GeminiService) {}

  async extract(input: { url?: string; text?: string }): Promise<JdResult> {
    if (input.text && input.text.trim().length > 0) {
      return {
        company: null,
        role: null,
        jdText: this.normalizeJd(input.text),
        sourceUrl: null,
      };
    }

    const url = input.url?.trim();
    if (!url) {
      throw new BadRequestException('Provide either `url` or `text`.');
    }

    const target = detectSingleJob(url);
    if (!target) {
      throw new BadRequestException(
        'Unsupported job board. Paste the JD text instead.',
      );
    }

    try {
      switch (target.type) {
        case 'greenhouse':
          return await this.fetchGreenhouse(target);
        case 'ashby':
          return await this.fetchAshby(target);
        case 'lever':
          return await this.fetchLever(target);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`JD fetch failed for ${url}: ${msg}`);
      throw new BadRequestException(`Could not fetch JD: ${msg}`);
    }
  }

  async extractKeywords(jdText: string, cv: string): Promise<KeywordBundle> {
    if (!jdText || jdText.trim().length < 40) {
      throw new BadRequestException('JD text too short for keyword extraction.');
    }
    return this.gemini.extractAtsKeywords(jdText, cv ?? '');
  }

  // ── ATS fetchers ───────────────────────────────────────────────────────

  private async fetchGreenhouse(target: SingleJobTarget): Promise<JdResult> {
    const json = await this.fetchJson(target.apiUrl);
    const root = json as Record<string, unknown>;
    return {
      company: this.pickString(root, ['company_name', 'companyName']),
      role: this.pickString(root, ['title']),
      jdText: this.normalizeJd(this.htmlToText(String(root.content ?? ''))),
      sourceUrl: target.sourceUrl,
    };
  }

  private async fetchAshby(target: SingleJobTarget): Promise<JdResult> {
    const json = await this.fetchJson(target.apiUrl);
    const root = json as Record<string, unknown>;
    const jobs = (root.jobs as Array<Record<string, unknown>>) || [];
    const match = jobs.find((j) => {
      const id = String(j.id ?? '');
      const slug = String(j.jobUrl ?? '').split('/').pop() ?? '';
      return id === target.jobId || slug === target.jobId;
    });
    if (!match) {
      throw new Error(
        `Job ${target.jobId} not found in Ashby board ${target.org ?? ''}`,
      );
    }
    const html =
      (match.descriptionHtml as string) ||
      (match.description as string) ||
      (match.descriptionPlain as string) ||
      '';
    return {
      company: this.pickString(match, ['departmentName']),
      role: this.pickString(match, ['title']),
      jdText: this.normalizeJd(this.htmlToText(html)),
      sourceUrl: target.sourceUrl,
    };
  }

  private async fetchLever(target: SingleJobTarget): Promise<JdResult> {
    const json = await this.fetchJson(target.apiUrl);
    const root = json as Record<string, unknown>;
    const html =
      (root.description as string) ||
      (root.descriptionPlain as string) ||
      (root.descriptionHtml as string) ||
      '';
    const lists = Array.isArray(root.lists) ? (root.lists as Array<Record<string, unknown>>) : [];
    const listsText = lists
      .map((l) => `${l.text ?? ''}\n${this.htmlToText(String(l.content ?? ''))}`)
      .join('\n\n');
    return {
      company: null,
      role: this.pickString(root, ['text']),
      jdText: this.normalizeJd(`${this.htmlToText(html)}\n\n${listsText}`),
      sourceUrl: target.sourceUrl,
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private async fetchJson(url: string): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  private htmlToText(html: string): string {
    if (!html) return '';
    return html
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/(p|li|h[1-6]|div)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
  }

  private normalizeJd(text: string): string {
    const collapsed = text
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return collapsed.length > MAX_JD_LENGTH
      ? `${collapsed.slice(0, MAX_JD_LENGTH)}\n\n[truncated]`
      : collapsed;
  }

  private pickString(
    obj: Record<string, unknown>,
    keys: string[],
  ): string | null {
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return null;
  }
}
