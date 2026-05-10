import { Injectable, Logger } from '@nestjs/common';
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, statSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { execFileSync } from 'child_process';
import { chromium } from 'playwright';

const ROOT = resolve(__dirname, '../../');

// ── Types────────

export interface DoctorCheck {
  pass: boolean;
  label: string;
  fix?: string | string[];
}

export interface DoctorResult {
  checks: DoctorCheck[];
  failures: number;
  passed: boolean;
}

export interface CvSyncResult {
  errors: string[];
  warnings: string[];
  passed: boolean;
}

export interface UpdateCheckResult {
  status: 'update-available' | 'up-to-date' | 'dismissed' | 'offline' | 'no-remote-version';
  local?: string;
  remote?: string;
  changelog?: string;
}

export interface UpdateApplyResult {
  success: boolean;
  message: string;
  from?: string;
  to?: string;
}

// ── Service──────

@Injectable()
export class SystemService {
  private readonly logger = new Logger(SystemService.name);

  // ── Doctor─────

  async doctor(): Promise<DoctorResult> {
    const checks: DoctorCheck[] = [
      this.checkNodeVersion(),
      this.checkDependencies(),
      await this.checkPlaywright(),
      this.checkLatex(),
      this.checkFile('cv.md', 'cv.md found', ['Create cv.md in the project root with your CV in markdown', 'See examples/ for reference CVs']),
      this.checkFile('config/profile.yml', 'config/profile.yml found', ['Run: cp config/profile.example.yml config/profile.yml', 'Then edit it with your details']),
      this.checkFile('portals.yml', 'portals.yml found', ['Run: cp templates/portals.example.yml portals.yml', 'Then customize with your target companies']),
      this.checkFonts(),
      this.checkAutoDir('data'),
      this.checkAutoDir('output'),
      this.checkAutoDir('reports'),
    ];

    const failures = checks.filter((c) => !c.pass).length;
    return { checks, failures, passed: failures === 0 };
  }

  // ── CV Sync Check─────

  cvSync(): CvSyncResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const cvPath = join(ROOT, 'cv.md');
    if (!existsSync(cvPath)) {
      errors.push('cv.md not found. Create it with your CV in markdown format.');
    } else if (readFileSync(cvPath, 'utf-8').trim().length < 100) {
      warnings.push('cv.md seems too short — make sure it contains your full CV.');
    }

    const profilePath = join(ROOT, 'config/profile.yml');
    if (!existsSync(profilePath)) {
      errors.push('config/profile.yml not found. Copy from config/profile.example.yml.');
    } else {
      const c = readFileSync(profilePath, 'utf-8');
      if (['full_name', 'email', 'location'].some((f) => !c.includes(f)) || c.includes('"Jane Smith"')) {
        warnings.push('config/profile.yml may still have example data — check full_name, email, location fields.');
      }
    }

    const metricPattern = /\b\d{2,4}\+?\s*(hours?|%|evals?|layers?|tests?|fields?|bases?)\b/gi;
    for (const { file, name } of [
      { file: join(ROOT, 'modes/_shared.md'), name: '_shared.md' },
      { file: join(ROOT, 'batch/batch-prompt.md'), name: 'batch-prompt.md' },
    ]) {
      if (!existsSync(file)) continue;
      for (const [i, line] of readFileSync(file, 'utf-8').split('\n').entries()) {
        if (line.includes('NEVER hardcode') || line.startsWith('#') || line.startsWith('<!--')) continue;
        const m = line.match(metricPattern);
        if (m) warnings.push(`${name}:${i + 1} — possible hardcoded metric: "${m[0]}"`);
      }
    }

    const digestPath = join(ROOT, 'article-digest.md');
    if (existsSync(digestPath)) {
      const days = (Date.now() - statSync(digestPath).mtimeMs) / (1000 * 60 * 60 * 24);
      if (days > 30) warnings.push(`article-digest.md is ${Math.round(days)} days old — consider updating with new metrics.`);
    }

    return { errors, warnings, passed: errors.length === 0 };
  }

  // ── Update Check──────

  async updateCheck(): Promise<UpdateCheckResult> {
    const dismissedPath = join(ROOT, '.update-dismissed');
    if (existsSync(dismissedPath)) return { status: 'dismissed' };

    const local = this.localVersion();
    const RAW_URL = 'https://raw.githubusercontent.com/santifer/career-ops/main/VERSION';
    const API_URL = 'https://api.github.com/repos/santifer/career-ops/releases/latest';
    const SEMVER = /^v?(\d+\.\d+\.\d+)$/i;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    let remote = '';
    let changelog = '';
    try {
      const [vRes, rRes] = await Promise.allSettled([
        fetch(RAW_URL, { signal: controller.signal }),
        fetch(API_URL, { headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'career-ops-api' }, signal: controller.signal }),
      ]);

      if (vRes.status === 'fulfilled' && vRes.value.ok) {
        const raw = (await vRes.value.text()).trim();
        const m = raw.match(SEMVER);
        if (m) remote = m[1];
      }
      if (rRes.status === 'fulfilled' && rRes.value.ok) {
        const rel = await rRes.value.json() as { tag_name?: string; body?: string };
        changelog = rel.body ?? '';
        if (!remote) {
          const m = String(rel.tag_name ?? '').match(SEMVER);
          if (m) remote = m[1];
        }
      }
    } catch {
      // network error
    } finally {
      clearTimeout(timer);
    }

    if (!remote) return { status: 'offline', local };
    if (this.compareVersions(local, remote) >= 0) return { status: 'up-to-date', local, remote };
    return { status: 'update-available', local, remote, changelog };
  }

  updateDismiss(): { dismissed: boolean } {
    writeFileSync(join(ROOT, '.update-dismissed'), new Date().toISOString());
    return { dismissed: true };
  }

  updateApply(): UpdateApplyResult {
    const local = this.localVersion();
    try {
      const backupBranch = `backup-pre-update-${Date.now()}`;
      this.git('checkout', '-b', backupBranch);
      this.git('fetch', 'upstream', 'main');
      this.git('checkout', 'upstream/main', '--', ...this.SYSTEM_PATHS());
      const newVersion = this.localVersion();
      this.git('add', '-A');
      this.git('commit', '-m', `chore: update career-ops system to v${newVersion}`);
      // Remove dismiss flag after successful update
      const dismissedPath = join(ROOT, '.update-dismissed');
      if (existsSync(dismissedPath)) unlinkSync(dismissedPath);
      return { success: true, message: `Updated from v${local} to v${newVersion}`, from: local, to: newVersion };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Update failed: ${msg}` };
    }
  }

  updateRollback(): UpdateApplyResult {
    try {
      const branches = this.git('branch', '--list', 'backup-pre-update-*');
      const backupBranches = branches.split('\n').map((b) => b.trim()).filter(Boolean).sort().reverse();
      if (backupBranches.length === 0) return { success: false, message: 'No backup branch found to roll back to.' };
      const latest = backupBranches[0];
      this.git('checkout', latest);
      return { success: true, message: `Rolled back to ${latest}` };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Rollback failed: ${msg}` };
    }
  }

  // ── Private helpers───

  private checkNodeVersion(): DoctorCheck {
    const major = parseInt(process.versions.node.split('.')[0]);
    return major >= 18
      ? { pass: true, label: `Node.js >= 18 (v${process.versions.node})` }
      : { pass: false, label: `Node.js >= 18 required (found v${process.versions.node})`, fix: 'Install Node.js 18+ from https://nodejs.org' };
  }

  private checkDependencies(): DoctorCheck {
    return existsSync(join(ROOT, 'node_modules'))
      ? { pass: true, label: 'Root dependencies installed' }
      : { pass: false, label: 'Root dependencies not installed', fix: 'Run: npm install' };
  }

  private async checkPlaywright(): Promise<DoctorCheck> {
    try {
      const execPath = chromium.executablePath();
      return existsSync(execPath)
        ? { pass: true, label: 'Playwright Chromium installed' }
        : { pass: false, label: 'Playwright Chromium not installed', fix: 'Run: npx playwright install chromium (in backend/)' };
    } catch {
      return { pass: false, label: 'Playwright Chromium not installed', fix: 'Run: npx playwright install chromium (in backend/)' };
    }
  }

  private checkLatex(): DoctorCheck {
    const fix = [
      'Local: brew install tectonic (preferred) or install MacTeX/BasicTeX',
      'Container: ensure Tectonic is baked into the image (see careerops-backend/Dockerfile)',
    ];
    for (const bin of ['tectonic', 'pdflatex']) {
      try {
        const version = execFileSync(bin, ['--version'], { encoding: 'utf-8', timeout: 5_000 })
          .split('\n')[0]
          .trim();
        return { pass: true, label: `LaTeX engine available (${bin}: ${version})` };
      } catch {
        // try next compiler
      }
    }
    return {
      pass: false,
      label: 'LaTeX engine not found — /api/v1/latex/compile will fail',
      fix,
    };
  }

  private checkFile(relPath: string, label: string, fix: string[]): DoctorCheck {
    return existsSync(join(ROOT, relPath))
      ? { pass: true, label }
      : { pass: false, label: `${label.replace(' found', ' not found')}`, fix };
  }

  private checkFonts(): DoctorCheck {
    const dir = join(ROOT, 'fonts');
    if (!existsSync(dir)) return { pass: false, label: 'fonts/ directory not found', fix: 'The fonts/ directory is required for PDF generation' };
    try {
      const files = readdirSync(dir);
      if (files.length === 0) return { pass: false, label: 'fonts/ directory is empty', fix: 'The fonts/ directory must contain font files for PDF generation' };
    } catch {
      return { pass: false, label: 'fonts/ directory not readable', fix: 'Check permissions on the fonts/ directory' };
    }
    return { pass: true, label: 'Fonts directory ready' };
  }

  private checkAutoDir(name: string): DoctorCheck {
    const dir = join(ROOT, name);
    if (existsSync(dir)) return { pass: true, label: `${name}/ directory ready` };
    try {
      mkdirSync(dir, { recursive: true });
      return { pass: true, label: `${name}/ directory ready (auto-created)` };
    } catch {
      return { pass: false, label: `${name}/ directory could not be created`, fix: `Run: mkdir ${name}` };
    }
  }

  private localVersion(): string {
    const vPath = join(ROOT, 'VERSION');
    return existsSync(vPath) ? readFileSync(vPath, 'utf-8').trim() : '0.0.0';
  }

  private compareVersions(a: string, b: string): number {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) < (pb[i] || 0)) return -1;
      if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    }
    return 0;
  }

  private git(...args: string[]): string {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8', timeout: 30_000 }).trim();
  }

  private SYSTEM_PATHS(): string[] {
    return [
      'modes/_shared.md', 'modes/_profile.template.md', 'modes/oferta.md', 'modes/pdf.md',
      'modes/scan.md', 'modes/batch.md', 'modes/apply.md', 'modes/auto-pipeline.md',
      'modes/contacto.md', 'modes/deep.md', 'modes/ofertas.md', 'modes/pipeline.md',
      'modes/project.md', 'modes/tracker.md', 'modes/training.md', 'modes/latex.md',
      'CLAUDE.md', 'AGENTS.md', 'GEMINI.md',
      'merge-tracker.mjs', 'verify-pipeline.mjs', 'dedup-tracker.mjs',
      'normalize-statuses.mjs', 'cv-sync-check.mjs', 'update-system.mjs',
      'doctor.mjs', 'check-liveness.mjs', 'liveness-core.mjs',
      'followup-cadence.mjs', 'generate-latex.mjs', 'test-all.mjs',
      'batch/batch-prompt.md', 'templates/', 'fonts/', 'VERSION',
    ];
  }
}
