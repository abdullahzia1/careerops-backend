import { Injectable, Logger } from '@nestjs/common';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import * as yaml from 'js-yaml';

const ROOT = resolve(__dirname, '../../');
const PORTALS_PATH = resolve(ROOT, 'portals.yml');
const SCAN_HISTORY_PATH = resolve(ROOT, 'data/scan-history.tsv');
const PIPELINE_PATH = resolve(ROOT, 'data/pipeline.md');
const APPLICATIONS_PATH = resolve(ROOT, 'data/applications.md');

const CONCURRENCY = 10;
const FETCH_TIMEOUT_MS = 10_000;

export interface JobListing {
  title: string;
  url: string;
  company: string;
  location: string;
  source: string;
}

export interface ScanResult {
  scannedAt: string;
  companiesScanned: number;
  companiesSkipped: number;
  totalFound: number;
  filtered: number;
  duplicates: number;
  newOffers: JobListing[];
  errors: Array<{ company: string; error: string }>;
}

export interface PortalCompany {
  name: string;
  enabled: boolean;
  careers_url?: string;
  api?: string;
  apiDetected: string | null;
}

interface ApiTarget {
  type: 'greenhouse' | 'ashby' | 'lever';
  url: string;
}

@Injectable()
export class ScanService {
  private readonly logger = new Logger(ScanService.name);

  listPortals(): PortalCompany[] {
    if (!existsSync(PORTALS_PATH)) return [];
    const config = yaml.load(readFileSync(PORTALS_PATH, 'utf-8')) as Record<string, unknown>;
    const companies = (config.tracked_companies as unknown[]) || [];
    return (companies as Array<Record<string, unknown>>).map((c) => ({
      name: String(c.name || ''),
      enabled: c.enabled !== false,
      careers_url: c.careers_url as string | undefined,
      api: c.api as string | undefined,
      apiDetected: this.detectApi(c)?.type ?? null,
    }));
  }

  async scan(options: { company?: string; dryRun?: boolean } = {}): Promise<ScanResult> {
    if (!existsSync(PORTALS_PATH)) {
      throw new Error('portals.yml not found. Complete onboarding first.');
    }

    const config = yaml.load(readFileSync(PORTALS_PATH, 'utf-8')) as Record<string, unknown>;
    const companies = (config.tracked_companies as Array<Record<string, unknown>>) || [];
    const titleFilter = this.buildTitleFilter(config.title_filter as Record<string, string[]> | undefined);

    const filterCompany = options.company?.toLowerCase();
    const targets = companies
      .filter((c) => c.enabled !== false)
      .filter((c) => !filterCompany || String(c.name).toLowerCase().includes(filterCompany))
      .map((c) => ({ ...c, name: String(c.name ?? ''), _api: this.detectApi(c) }))
      .filter((c) => c._api !== null);

    const skippedCount =
      companies.filter((c) => c.enabled !== false).length - targets.length;

    const seenUrls = this.loadSeenUrls();
    const seenCompanyRoles = this.loadSeenCompanyRoles();

    const date = new Date().toISOString().slice(0, 10);
    let totalFound = 0;
    let totalFiltered = 0;
    let totalDupes = 0;
    const newOffers: JobListing[] = [];
    const errors: Array<{ company: string; error: string }> = [];

    const tasks = targets.map(
      (company) => async () => {
        const api = company._api as ApiTarget;
        try {
          const json = await this.fetchJson(api.url);
          const jobs = this.parseJobs(api.type, json, String(company.name));
          totalFound += jobs.length;

          for (const job of jobs) {
            if (!titleFilter(job.title)) {
              totalFiltered++;
              continue;
            }
            if (seenUrls.has(job.url)) {
              totalDupes++;
              continue;
            }
            const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`;
            if (seenCompanyRoles.has(key)) {
              totalDupes++;
              continue;
            }
            seenUrls.add(job.url);
            seenCompanyRoles.add(key);
            newOffers.push({ ...job, source: `${api.type}-api` });
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push({ company: String(company.name), error: msg });
        }
      },
    );

    await this.parallelFetch(tasks, CONCURRENCY);

    this.logger.log(
      `Scan complete: ${targets.length} companies, ${newOffers.length} new offers, ${errors.length} errors`,
    );

    return {
      scannedAt: new Date().toISOString(),
      companiesScanned: targets.length,
      companiesSkipped: skippedCount,
      totalFound,
      filtered: totalFiltered,
      duplicates: totalDupes,
      newOffers,
      errors,
    };
  }

  // ── Private helpers────

  private detectApi(company: Record<string, unknown>): ApiTarget | null {
    if (typeof company.api === 'string' && company.api.includes('greenhouse')) {
      return { type: 'greenhouse', url: company.api };
    }

    const url = String(company.careers_url || '');

    const ashbyMatch = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
    if (ashbyMatch) {
      return {
        type: 'ashby',
        url: `https://api.ashbyhq.com/posting-api/job-board/${ashbyMatch[1]}?includeCompensation=true`,
      };
    }

    const leverMatch = url.match(/jobs\.lever\.co\/([^/?#]+)/);
    if (leverMatch) {
      return {
        type: 'lever',
        url: `https://api.lever.co/v0/postings/${leverMatch[1]}`,
      };
    }

    const ghEuMatch = url.match(/job-boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/);
    if (ghEuMatch && !company.api) {
      return {
        type: 'greenhouse',
        url: `https://boards-api.greenhouse.io/v1/boards/${ghEuMatch[1]}/jobs`,
      };
    }

    return null;
  }

  private parseJobs(
    type: string,
    json: Record<string, unknown>,
    company: string,
  ): Array<{ title: string; url: string; company: string; location: string }> {
    if (type === 'greenhouse') {
      const jobs = (json.jobs as Array<Record<string, unknown>>) || [];
      return jobs.map((j) => ({
        title: String(j.title || ''),
        url: String(j.absolute_url || ''),
        company,
        location: String((j.location as Record<string, unknown>)?.name || ''),
      }));
    }
    if (type === 'ashby') {
      const jobs = (json.jobs as Array<Record<string, unknown>>) || [];
      return jobs.map((j) => ({
        title: String(j.title || ''),
        url: String(j.jobUrl || ''),
        company,
        location: String(j.location || ''),
      }));
    }
    if (type === 'lever') {
      if (!Array.isArray(json)) return [];
      return (json as Array<Record<string, unknown>>).map((j) => ({
        title: String(j.text || ''),
        url: String(j.hostedUrl || ''),
        company,
        location: String((j.categories as Record<string, unknown>)?.location || ''),
      }));
    }
    return [];
  }

  private buildTitleFilter(
    titleFilter: Record<string, string[]> | undefined,
  ): (title: string) => boolean {
    const positive = (titleFilter?.positive || []).map((k) => k.toLowerCase());
    const negative = (titleFilter?.negative || []).map((k) => k.toLowerCase());
    return (title: string) => {
      const lower = title.toLowerCase();
      const hasPositive = positive.length === 0 || positive.some((k) => lower.includes(k));
      const hasNegative = negative.some((k) => lower.includes(k));
      return hasPositive && !hasNegative;
    };
  }

  private loadSeenUrls(): Set<string> {
    const seen = new Set<string>();
    if (existsSync(SCAN_HISTORY_PATH)) {
      const lines = readFileSync(SCAN_HISTORY_PATH, 'utf-8').split('\n');
      for (const line of lines.slice(1)) {
        const url = line.split('\t')[0];
        if (url) seen.add(url);
      }
    }
    if (existsSync(PIPELINE_PATH)) {
      const text = readFileSync(PIPELINE_PATH, 'utf-8');
      for (const match of text.matchAll(/- \[[ x]\] (https?:\/\/\S+)/g)) {
        seen.add(match[1]);
      }
    }
    if (existsSync(APPLICATIONS_PATH)) {
      const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
      for (const match of text.matchAll(/https?:\/\/[^\s|)]+/g)) {
        seen.add(match[0]);
      }
    }
    return seen;
  }

  private loadSeenCompanyRoles(): Set<string> {
    const seen = new Set<string>();
    if (existsSync(APPLICATIONS_PATH)) {
      const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
      for (const match of text.matchAll(
        /\|[^|]+\|[^|]+\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g,
      )) {
        const company = match[1].trim().toLowerCase();
        const role = match[2].trim().toLowerCase();
        if (company && role && company !== 'company') {
          seen.add(`${company}::${role}`);
        }
      }
    }
    return seen;
  }

  private async fetchJson(url: string): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as Record<string, unknown>;
    } finally {
      clearTimeout(timer);
    }
  }

  private async parallelFetch(
    tasks: Array<() => Promise<void>>,
    limit: number,
  ): Promise<void> {
    let i = 0;
    const next = async () => {
      while (i < tasks.length) {
        const task = tasks[i++];
        await task();
      }
    };
    const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => next());
    await Promise.all(workers);
  }
}
