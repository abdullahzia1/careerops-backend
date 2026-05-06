import { Injectable, Logger } from '@nestjs/common';
import {
  existsSync, readFileSync, writeFileSync, copyFileSync,
  readdirSync, mkdirSync, renameSync,
} from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(__dirname, '../../');
const APPS_FILE = existsSync(join(ROOT, 'data/applications.md'))
  ? join(ROOT, 'data/applications.md')
  : join(ROOT, 'applications.md');
const ADDITIONS_DIR = join(ROOT, 'batch/tracker-additions');
const REPORTS_DIR = join(ROOT, 'reports');

const CANONICAL = ['evaluated', 'applied', 'responded', 'interview', 'offer', 'rejected', 'discarded', 'skip'];

const ALIASES: Record<string, string> = {
  evaluada: 'evaluated', condicional: 'evaluated', hold: 'evaluated', evaluar: 'evaluated', verificar: 'evaluated',
  aplicado: 'applied', enviada: 'applied', aplicada: 'applied', applied: 'applied', sent: 'applied',
  respondido: 'responded', entrevista: 'interview', oferta: 'offer',
  rechazado: 'rejected', rechazada: 'rejected',
  descartado: 'discarded', descartada: 'discarded', cerrada: 'discarded', cancelada: 'discarded',
  'no aplicar': 'skip', no_aplicar: 'skip', monitor: 'skip', 'geo blocker': 'skip',
};

// ── Shared helpers ───────────────────────────────────────────────────

function parseAppsFile() {
  if (!existsSync(APPS_FILE)) return { header: [], entries: [], lines: [] as string[] };
  const lines = readFileSync(APPS_FILE, 'utf-8').split('\n');
  const entries: Array<{ lineIdx: number; num: number; date: string; company: string; role: string; score: string; status: string; pdf: string; report: string; notes: string }> = [];
  const header: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('|')) { if (entries.length === 0) header.push(line); continue; }
    const p = line.split('|').map((s) => s.trim());
    if (p.length < 9) continue;
    const num = parseInt(p[1]);
    if (isNaN(num)) continue;
    entries.push({ lineIdx: i, num, date: p[2], company: p[3], role: p[4], score: p[5], status: p[6], pdf: p[7], report: p[8], notes: p[9] ?? '' });
  }
  return { header, entries, lines };
}

function reconstructLine(p: string[]): string {
  return '| ' + p.join(' | ') + ' |';
}

function normalizeStatusStr(raw: string): string {
  const s = raw.replace(/\*\*/g, '').trim().toLowerCase().replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();
  return ALIASES[s] ?? s;
}

// ── Types ─────────────────────────────────────────────────────────────

export interface VerifyResult {
  entriesChecked: number;
  errors: string[];
  warnings: string[];
  passed: boolean;
}

export interface NormalizeResult {
  changes: number;
  unknowns: string[];
  written: boolean;
}

export interface DedupResult {
  removed: number;
  promoted: Array<{ num: number; from: string; to: string }>;
  written: boolean;
}

export interface MergeResult {
  added: number;
  updated: number;
  skipped: number;
  tsvsProcessed: number;
  written: boolean;
}

@Injectable()
export class TrackerService {
  private readonly logger = new Logger(TrackerService.name);

  // ── Verify ─────────────────────────────────────────────────────────

  verify(): VerifyResult {
    if (!existsSync(APPS_FILE)) {
      return { entriesChecked: 0, errors: [], warnings: [], passed: true };
    }

    const { entries } = parseAppsFile();
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Canonical statuses
    const seenCompanyRole = new Map<string, number>();
    for (const e of entries) {
      const s = normalizeStatusStr(e.status);
      if (!CANONICAL.includes(s)) errors.push(`#${e.num}: non-canonical status "${e.status}"`);
      if (e.status.includes('**')) errors.push(`#${e.num}: status has markdown bold "${e.status}"`);
      if (/\d{4}-\d{2}-\d{2}/.test(e.status)) errors.push(`#${e.num}: status has embedded date "${e.status}"`);

      // 2. Duplicate company+role
      const key = `${e.company.toLowerCase()}::${e.role.toLowerCase()}`;
      if (seenCompanyRole.has(key)) {
        warnings.push(`#${e.num}: duplicate of #${seenCompanyRole.get(key)} — ${e.company} / ${e.role}`);
      } else {
        seenCompanyRole.set(key, e.num);
      }

      // 3. Score format
      if (e.score && !['N/A', 'DUP', ''].includes(e.score) && !/^\d+(\.\d+)?\/5$/.test(e.score.replace(/\*\*/g, ''))) {
        warnings.push(`#${e.num}: unexpected score format "${e.score}"`);
      }

      // 4. Report file exists
      const reportMatch = e.report.match(/\]\(([^)]+)\)/);
      if (reportMatch) {
        const reportPath = join(ROOT, reportMatch[1]);
        if (!existsSync(reportPath)) {
          warnings.push(`#${e.num}: report file missing — ${reportMatch[1]}`);
        }
      }
    }

    // 5. Pending TSVs
    if (existsSync(ADDITIONS_DIR)) {
      const pending = readdirSync(ADDITIONS_DIR).filter((f) => f.endsWith('.tsv'));
      if (pending.length > 0) {
        warnings.push(`${pending.length} unmerged TSV(s) in batch/tracker-additions/ — run POST /api/v1/tracker/merge`);
      }
    }

    this.logger.log(`Verify: ${entries.length} entries, ${errors.length} errors, ${warnings.length} warnings`);
    return { entriesChecked: entries.length, errors, warnings, passed: errors.length === 0 };
  }

  // ── Normalize ──────────────────────────────────────────────────────

  normalize(dryRun = false): NormalizeResult {
    if (!existsSync(APPS_FILE)) return { changes: 0, unknowns: [], written: false };

    const fileLines = readFileSync(APPS_FILE, 'utf-8').split('\n');
    let changes = 0;
    const unknowns: string[] = [];

    for (let i = 0; i < fileLines.length; i++) {
      const line = fileLines[i];
      if (!line.startsWith('|')) continue;
      const p = line.split('|').map((s) => s.trim());
      if (p.length < 9) continue;
      const num = parseInt(p[1]);
      if (isNaN(num) || p[1] === '#' || p[1] === '---') continue;

      const rawStatus = p[6];
      const result = this.normalizeStatusFull(rawStatus);

      if (result.unknown) { unknowns.push(`#${num}: "${rawStatus}"`); continue; }
      if (result.status === rawStatus) continue;

      p[6] = result.status!;
      if (result.moveToNotes) {
        const n = p[9] ?? '';
        p[9] = result.moveToNotes + (n ? '. ' + n : '');
      }
      if (p[5]) p[5] = p[5].replace(/\*\*/g, '');
      fileLines[i] = reconstructLine(p.slice(1, -1));
      changes++;
    }

    const written = !dryRun && changes > 0;
    if (written) {
      copyFileSync(APPS_FILE, APPS_FILE + '.bak');
      writeFileSync(APPS_FILE, fileLines.join('\n'));
    }

    return { changes, unknowns, written };
  }

  // ── Dedup ──────────────────────────────────────────────────────────

  dedup(dryRun = false): DedupResult {
    if (!existsSync(APPS_FILE)) return { removed: 0, promoted: [], written: false };

    const fileLines = readFileSync(APPS_FILE, 'utf-8').split('\n');
    const entries: Array<{ lineIdx: number; num: number; company: string; role: string; score: number; status: string; raw: string }> = [];

    for (let i = 0; i < fileLines.length; i++) {
      const line = fileLines[i];
      if (!line.startsWith('|')) continue;
      const p = line.split('|').map((s) => s.trim());
      if (p.length < 9) continue;
      const num = parseInt(p[1]);
      if (isNaN(num) || num === 0) continue;
      entries.push({
        lineIdx: i, num,
        company: p[3], role: p[4],
        score: this.parseScore(p[5]),
        status: p[6],
        raw: line,
      });
    }

    const groups = new Map<string, typeof entries>();
    for (const e of entries) {
      const key = this.normalizeCompany(e.company);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }

    const linesToRemove = new Set<number>();
    const promoted: Array<{ num: number; from: string; to: string }> = [];

    for (const companyEntries of groups.values()) {
      if (companyEntries.length < 2) continue;
      const processed = new Set<number>();

      for (let i = 0; i < companyEntries.length; i++) {
        if (processed.has(i)) continue;
        const cluster = [companyEntries[i]];
        processed.add(i);

        for (let j = i + 1; j < companyEntries.length; j++) {
          if (!processed.has(j) && this.roleMatch(companyEntries[i].role, companyEntries[j].role)) {
            cluster.push(companyEntries[j]);
            processed.add(j);
          }
        }
        if (cluster.length < 2) continue;

        cluster.sort((a, b) => b.score - a.score);
        const keeper = cluster[0];

        const STATUS_RANK: Record<string, number> = {
          skip: 0, discarded: 0, rejected: 1, evaluated: 2, applied: 3, responded: 4, interview: 5, offer: 6,
        };
        let bestRank = STATUS_RANK[keeper.status.toLowerCase()] ?? 0;
        let bestStatus = keeper.status;

        for (let k = 1; k < cluster.length; k++) {
          const rank = STATUS_RANK[cluster[k].status.toLowerCase()] ?? 0;
          if (rank > bestRank) { bestRank = rank; bestStatus = cluster[k].status; }
        }

        if (bestStatus !== keeper.status) {
          const p = fileLines[keeper.lineIdx].split('|').map((s) => s.trim());
          promoted.push({ num: keeper.num, from: keeper.status, to: bestStatus });
          p[6] = bestStatus;
          fileLines[keeper.lineIdx] = reconstructLine(p.slice(1, -1));
        }

        for (let k = 1; k < cluster.length; k++) {
          linesToRemove.add(cluster[k].lineIdx);
        }
      }
    }

    const sortedRemove = [...linesToRemove].sort((a, b) => b - a);
    for (const idx of sortedRemove) fileLines.splice(idx, 1);

    const removed = linesToRemove.size;
    const written = !dryRun && (removed > 0 || promoted.length > 0);
    if (written) {
      copyFileSync(APPS_FILE, APPS_FILE + '.bak');
      writeFileSync(APPS_FILE, fileLines.join('\n'));
    }

    return { removed, promoted, written };
  }

  // ── Merge TSVs ─────────────────────────────────────────────────────

  merge(dryRun = false): MergeResult {
    if (!existsSync(ADDITIONS_DIR)) {
      return { added: 0, updated: 0, skipped: 0, tsvsProcessed: 0, written: false };
    }

    const tsvFiles = readdirSync(ADDITIONS_DIR).filter((f) => f.endsWith('.tsv'));
    if (tsvFiles.length === 0) {
      return { added: 0, updated: 0, skipped: 0, tsvsProcessed: 0, written: false };
    }

    let content = existsSync(APPS_FILE) ? readFileSync(APPS_FILE, 'utf-8') : '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n';

    let added = 0, updated = 0, skipped = 0;

    for (const f of tsvFiles) {
      const tsvPath = join(ADDITIONS_DIR, f);
      const lines = readFileSync(tsvPath, 'utf-8').trim().split('\n').filter((l) => l.trim() && !l.startsWith('#'));

      for (const line of lines) {
        const cols = line.split('\t').map((c) => c.trim());
        if (cols.length < 9) { skipped++; continue; }
        const [num, date, company, role, status, score, pdf, report, notes] = cols;

        // Check if entry already exists
        const existing = new RegExp(`^\\|\\s*${num}\\s*\\|`);
        if (existing.test(content)) {
          // Update score and report if new values are better
          content = content.replace(
            new RegExp(`(\\|\\s*${num}\\s*\\|[^|]+\\|[^|]+\\|[^|]+\\|)[^|]*(\\|[^|]*\\|)[^|]*(\\|.*)`),
            (_, pre, mid, post) => `${pre} ${score} ${mid} ${report} ${post}`,
          );
          updated++;
        } else {
          const row = `| ${num} | ${date} | ${company} | ${role} | ${score} | ${status} | ${pdf} | ${report} | ${notes} |`;
          content = content.trimEnd() + '\n' + row + '\n';
          added++;
        }
      }

      if (!dryRun) {
        const mergedDir = join(ADDITIONS_DIR, 'merged');
        mkdirSync(mergedDir, { recursive: true });
        renameSync(tsvPath, join(mergedDir, f));
      }
    }

    const written = !dryRun && (added > 0 || updated > 0);
    if (written) {
      mkdirSync(join(ROOT, 'data'), { recursive: true });
      copyFileSync(APPS_FILE, APPS_FILE + '.bak');
      writeFileSync(APPS_FILE, content);
    }

    return { added, updated, skipped, tsvsProcessed: tsvFiles.length, written };
  }

  // ── Private helpers ────────────────────────────────────────────────

  private normalizeStatusFull(raw: string): { status: string | null; moveToNotes?: string; unknown?: boolean } {
    let s = raw.replace(/\*\*/g, '').trim();
    const lower = s.toLowerCase();
    if (/^duplicado/i.test(s) || /^dup\b/i.test(s)) return { status: 'Discarded', moveToNotes: raw.trim() };
    if (/^(cerrada|cancelada|descartada|descartado)$/i.test(s)) return { status: 'Discarded' };
    if (/^rechazada?$/i.test(s) || /^rechazado\s+\d{4}/i.test(s)) return { status: 'Rejected' };
    if (/^aplicado\s+\d{4}/i.test(s)) return { status: 'Applied' };
    if (/^(condicional|hold|evaluar|verificar)$/i.test(s)) return { status: 'Evaluated' };
    if (/^monitor$/i.test(s)) return { status: 'SKIP' };
    if (/geo.?blocker/i.test(s)) return { status: 'SKIP' };
    if (/^repost/i.test(s)) return { status: 'Discarded', moveToNotes: raw.trim() };
    if (s === '—' || s === '-' || s === '') return { status: 'Discarded' };
    const canonical = ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Rejected', 'Discarded', 'SKIP'];
    for (const c of canonical) if (lower === c.toLowerCase()) return { status: c };
    if (['evaluada'].includes(lower)) return { status: 'Evaluated' };
    if (['aplicado', 'enviada', 'aplicada', 'applied', 'sent'].includes(lower)) return { status: 'Applied' };
    if (['respondido'].includes(lower)) return { status: 'Responded' };
    if (['entrevista'].includes(lower)) return { status: 'Interview' };
    if (['oferta'].includes(lower)) return { status: 'Offer' };
    if (['cerrada', 'descartada'].includes(lower)) return { status: 'Discarded' };
    if (['no aplicar', 'no_aplicar', 'skip'].includes(lower)) return { status: 'SKIP' };
    return { status: null, unknown: true };
  }

  private parseScore(s: string): number {
    const m = s.replace(/\*\*/g, '').match(/([\d.]+)/);
    return m ? parseFloat(m[1]) : 0;
  }

  private normalizeCompany(name: string): string {
    return name.toLowerCase().replace(/[()]/g, '').replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '').trim();
  }

  private normalizeRole(role: string): string {
    return role.toLowerCase().replace(/[()]/g, ' ').replace(/\s+/g, ' ').replace(/[^a-z0-9 /]/g, '').trim();
  }

  private roleMatch(a: string, b: string): boolean {
    const STOP = new Set(['senior', 'junior', 'lead', 'staff', 'principal', 'head', 'chief', 'manager', 'director', 'associate', 'intern', 'contractor', 'remote', 'hybrid', 'onsite', 'engineer', 'engineering', 'tokyo', 'japan', 'london', 'berlin', 'paris', 'singapore', 'york', 'francisco', 'angeles', 'seattle', 'austin', 'boston', 'chicago', 'denver', 'toronto', 'amsterdam', 'dublin', 'sydney', 'remote', 'global', 'emea', 'apac', 'latam']);
    const words = (s: string) => this.normalizeRole(s).split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
    const wa = words(a), wb = words(b);
    if (!wa.length || !wb.length) return false;
    const overlap = wa.filter((w) => wb.includes(w));
    return overlap.length >= 2 && overlap.length / Math.min(wa.length, wb.length) >= 0.6;
  }
}
