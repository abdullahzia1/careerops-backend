import { Injectable, Logger } from '@nestjs/common';
import { chromium } from 'playwright';

// ── Classification logic (port of liveness-core.mjs) ────────────────

const HARD_EXPIRED = [
  /job (is )?no longer available/i,
  /job.*no longer open/i,
  /position has been filled/i,
  /this job has expired/i,
  /job posting has expired/i,
  /no longer accepting applications/i,
  /this (position|role|job) (is )?no longer/i,
  /this job (listing )?is closed/i,
  /job (listing )?not found/i,
  /the page you are looking for doesn.t exist/i,
  /applications?\s+(?:(?:have|are|is)\s+)?closed/i,
  /closed on \d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
  /closed on (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}/i,
  /diese stelle (ist )?(nicht mehr|bereits) besetzt/i,
  /offre (expirée|n'est plus disponible)/i,
];

const LISTING_PAGE = [/\d+\s+jobs?\s+found/i, /search for jobs page is loaded/i];
const EXPIRED_URL = [/[?&]error=true/i];
const APPLY_PATTERNS = [
  /\bapply\b/i, /\bsolicitar\b/i, /\bbewerben\b/i, /\bpostuler\b/i,
  /submit application/i, /easy apply/i, /start application/i, /ich bewerbe mich/i,
];
const MIN_CONTENT = 300;

function classifyLiveness(opts: {
  status: number;
  finalUrl: string;
  bodyText: string;
  applyControls: string[];
}): { result: 'active' | 'expired' | 'uncertain'; reason: string } {
  const { status, finalUrl, bodyText, applyControls } = opts;

  if (status === 404 || status === 410) return { result: 'expired', reason: `HTTP ${status}` };

  if (EXPIRED_URL.some((p) => p.test(finalUrl))) {
    return { result: 'expired', reason: `redirect to ${finalUrl}` };
  }

  const expPat = HARD_EXPIRED.find((p) => p.test(bodyText));
  if (expPat) return { result: 'expired', reason: `pattern: ${expPat.source}` };

  if (applyControls.some((c) => APPLY_PATTERNS.some((p) => p.test(c)))) {
    return { result: 'active', reason: 'visible apply control detected' };
  }

  const listPat = LISTING_PAGE.find((p) => p.test(bodyText));
  if (listPat) return { result: 'expired', reason: `listing page: ${listPat.source}` };

  if (bodyText.trim().length < MIN_CONTENT) {
    return { result: 'expired', reason: 'insufficient content — likely nav/footer only' };
  }

  return { result: 'uncertain', reason: 'content present but no visible apply control found' };
}

// ── Service ──────────────────────────────────────────────────────────

export interface LivenessCheckResult {
  url: string;
  result: 'active' | 'expired' | 'uncertain';
  reason: string;
  httpStatus?: number;
  finalUrl?: string;
  checkedAt: string;
}

@Injectable()
export class LivenessService {
  private readonly logger = new Logger(LivenessService.name);

  async checkUrls(urls: string[]): Promise<LivenessCheckResult[]> {
    const browser = await chromium.launch({ headless: true });
    const results: LivenessCheckResult[] = [];

    try {
      for (const url of urls) {
        results.push(await this.checkOne(browser, url));
      }
    } finally {
      await browser.close();
    }

    return results;
  }

  private async checkOne(
    browser: Awaited<ReturnType<typeof chromium.launch>>,
    url: string,
  ): Promise<LivenessCheckResult> {
    const context = await browser.newContext();
    const page = await context.newPage();
    let httpStatus = 0;
    let finalUrl = url;

    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      httpStatus = response?.status() ?? 0;
      finalUrl = page.url();

      const bodyText = await page.evaluate(() => document.body?.innerText ?? '');
      const applyControls = await page.evaluate(() => {
        const controls: string[] = [];
        document.querySelectorAll<HTMLElement>('button, a, input[type="submit"]').forEach((el) => {
          const text = el.textContent?.trim() || el.getAttribute('value') || '';
          if (text) controls.push(text);
        });
        return controls;
      });

      const { result, reason } = classifyLiveness({ status: httpStatus, finalUrl, bodyText, applyControls });
      this.logger.debug(`${url} → ${result} (${reason})`);

      return { url, result, reason, httpStatus, finalUrl, checkedAt: new Date().toISOString() };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { url, result: 'uncertain', reason: `error: ${msg}`, httpStatus, finalUrl, checkedAt: new Date().toISOString() };
    } finally {
      await context.close();
    }
  }
}
