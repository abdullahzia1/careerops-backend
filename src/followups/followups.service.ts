import { Injectable } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(__dirname, '../../');
const APPS_FILE = existsSync(join(ROOT, 'data/applications.md'))
  ? join(ROOT, 'data/applications.md')
  : join(ROOT, 'applications.md');
const FOLLOWUPS_FILE = join(ROOT, 'data/follow-ups.md');

const ALIASES: Record<string, string> = {
  evaluada: 'evaluated', condicional: 'evaluated', hold: 'evaluated',
  evaluar: 'evaluated', verificar: 'evaluated',
  aplicado: 'applied', enviada: 'applied', aplicada: 'applied',
  applied: 'applied', sent: 'applied',
  respondido: 'responded', entrevista: 'interview', oferta: 'offer',
  rechazado: 'rejected', rechazada: 'rejected',
  descartado: 'discarded', descartada: 'discarded',
  cerrada: 'discarded', cancelada: 'discarded',
  'no aplicar': 'skip', no_aplicar: 'skip', monitor: 'skip', 'geo blocker': 'skip',
};

const ACTIONABLE = ['applied', 'responded', 'interview'];

function normalizeStatus(raw: string): string {
  const clean = raw.replace(/\*\*/g, '').trim().toLowerCase()
    .replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();
  return ALIASES[clean] ?? clean;
}

function today(): Date {
  return new Date(new Date().toISOString().split('T')[0]);
}

function parseDate(s: string): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s.trim())) return null;
  return new Date(s.trim());
}

function daysBetween(d1: Date, d2: Date): number {
  return Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

function addDays(d: Date, n: number): string {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r.toISOString().split('T')[0];
}

export interface FollowupEntry {
  num: number;
  date: string;
  company: string;
  role: string;
  status: string;
  score: string;
  notes: string;
  reportPath: string | null;
  contacts: Array<{ email: string; name: string | null }>;
  daysSinceApplication: number;
  daysSinceLastFollowup: number | null;
  followupCount: number;
  urgency: 'urgent' | 'overdue' | 'waiting' | 'cold';
  nextFollowupDate: string | null;
  daysUntilNext: number | null;
}

export interface FollowupsResult {
  metadata: {
    analysisDate: string;
    totalTracked: number;
    actionable: number;
    overdue: number;
    urgent: number;
    cold: number;
    waiting: number;
  };
  entries: FollowupEntry[];
  cadenceConfig: Record<string, number>;
}

export interface FollowupsError { error: string }

@Injectable()
export class FollowupsService {
  analyze(opts: { overdueOnly?: boolean; appliedFirstDays?: number } = {}): FollowupsResult | FollowupsError {
    const CADENCE = {
      applied_first: opts.appliedFirstDays ?? 7,
      applied_subsequent: 7,
      applied_max_followups: 2,
      responded_initial: 1,
      responded_subsequent: 3,
      interview_thankyou: 1,
    };

    const apps = this.parseTracker();
    if (apps.length === 0) return { error: 'No applications found in tracker.' };

    const rawFollowups = this.parseFollowups();
    const followupsByApp = new Map<number, typeof rawFollowups>();
    for (const fu of rawFollowups) {
      if (!followupsByApp.has(fu.appNum)) followupsByApp.set(fu.appNum, []);
      followupsByApp.get(fu.appNum)!.push(fu);
    }

    const now = today();
    const entries: FollowupEntry[] = [];

    for (const app of apps) {
      const normalized = normalizeStatus(app.status);
      if (!ACTIONABLE.includes(normalized)) continue;
      const appDate = parseDate(app.date);
      if (!appDate) continue;

      const daysSinceApp = daysBetween(appDate, now);
      const appFollowups = followupsByApp.get(app.num) ?? [];
      const followupCount = appFollowups.length;
      let lastFollowupDate: string | null = null;
      let daysSinceLastFollowup: number | null = null;

      if (appFollowups.length > 0) {
        const sorted = [...appFollowups].sort((a, b) => (a.date > b.date ? -1 : 1));
        lastFollowupDate = sorted[0].date;
        const ld = parseDate(lastFollowupDate);
        if (ld) daysSinceLastFollowup = daysBetween(ld, now);
      }

      const urgency = this.computeUrgency(normalized, daysSinceApp, daysSinceLastFollowup, followupCount, CADENCE);
      const nextFollowupDate = this.computeNextFollowupDate(normalized, app.date, lastFollowupDate, followupCount, CADENCE);
      const nextDate = nextFollowupDate ? parseDate(nextFollowupDate) : null;
      const daysUntilNext = nextDate ? daysBetween(now, nextDate) : null;

      entries.push({
        num: app.num,
        date: app.date,
        company: app.company,
        role: app.role,
        status: normalized,
        score: app.score,
        notes: app.notes,
        reportPath: this.resolveReport(app.report),
        contacts: this.extractContacts(app.notes),
        daysSinceApplication: daysSinceApp,
        daysSinceLastFollowup,
        followupCount,
        urgency,
        nextFollowupDate,
        daysUntilNext,
      });
    }

    const urgencyOrder: Record<string, number> = { urgent: 0, overdue: 1, waiting: 2, cold: 3 };
    entries.sort((a, b) => (urgencyOrder[a.urgency] ?? 9) - (urgencyOrder[b.urgency] ?? 9));

    const filtered = opts.overdueOnly
      ? entries.filter((e) => e.urgency === 'overdue' || e.urgency === 'urgent')
      : entries;

    return {
      metadata: {
        analysisDate: now.toISOString().split('T')[0],
        totalTracked: apps.length,
        actionable: entries.length,
        overdue: entries.filter((e) => e.urgency === 'overdue').length,
        urgent: entries.filter((e) => e.urgency === 'urgent').length,
        cold: entries.filter((e) => e.urgency === 'cold').length,
        waiting: entries.filter((e) => e.urgency === 'waiting').length,
      },
      entries: filtered,
      cadenceConfig: CADENCE,
    };
  }

  private computeUrgency(
    status: string, daysSince: number, daysSinceLastFu: number | null,
    count: number, c: Record<string, number>,
  ): FollowupEntry['urgency'] {
    if (status === 'applied') {
      if (count >= c.applied_max_followups) return 'cold';
      if (count === 0 && daysSince >= c.applied_first) return 'overdue';
      if (count > 0 && daysSinceLastFu !== null && daysSinceLastFu >= c.applied_subsequent) return 'overdue';
      return 'waiting';
    }
    if (status === 'responded') {
      if (daysSince < c.responded_initial) return 'urgent';
      if (daysSince >= c.responded_subsequent) return 'overdue';
      return 'waiting';
    }
    if (status === 'interview') {
      if (daysSince >= c.interview_thankyou) return 'overdue';
      return 'waiting';
    }
    return 'waiting';
  }

  private computeNextFollowupDate(
    status: string, appDate: string, lastFuDate: string | null,
    count: number, c: Record<string, number>,
  ): string | null {
    const base = parseDate(appDate);
    if (!base) return null;
    if (status === 'applied') {
      if (count >= c.applied_max_followups) return null;
      if (count === 0) return addDays(base, c.applied_first);
      if (lastFuDate) return addDays(parseDate(lastFuDate)!, c.applied_subsequent);
      return addDays(base, c.applied_first);
    }
    if (status === 'responded') {
      if (lastFuDate) return addDays(parseDate(lastFuDate)!, c.responded_subsequent);
      return addDays(base, c.responded_subsequent);
    }
    if (status === 'interview') return addDays(base, c.interview_thankyou);
    return null;
  }

  private extractContacts(notes: string): Array<{ email: string; name: string | null }> {
    const contacts: Array<{ email: string; name: string | null }> = [];
    const emails = notes.match(/[\w.-]+@[\w.-]+\.\w+/g) ?? [];
    for (const email of emails) {
      const before = notes.substring(0, notes.indexOf(email));
      const nameMatch = before.match(
        /(?:Emailed|emailed|contact[:\s]+|to\s+)([A-Z][a-z]+ ?[A-Z]?[a-z]*)\s*(?:at|@|$)/i,
      );
      contacts.push({ email, name: nameMatch ? nameMatch[1].trim() : null });
    }
    return contacts;
  }

  private resolveReport(field: string): string | null {
    const m = field.match(/\]\(([^)]+)\)/);
    if (!m) return null;
    const full = join(ROOT, m[1]);
    return existsSync(full) ? m[1] : null;
  }

  private parseTracker() {
    if (!existsSync(APPS_FILE)) return [];
    const entries: Array<{ num: number; date: string; company: string; role: string; score: string; status: string; pdf: string; report: string; notes: string }> = [];
    for (const line of readFileSync(APPS_FILE, 'utf-8').split('\n')) {
      if (!line.startsWith('|')) continue;
      const p = line.split('|').map((s) => s.trim());
      if (p.length < 9) continue;
      const num = parseInt(p[1]);
      if (isNaN(num)) continue;
      entries.push({ num, date: p[2], company: p[3], role: p[4], score: p[5], status: p[6], pdf: p[7], report: p[8], notes: p[9] ?? '' });
    }
    return entries;
  }

  private parseFollowups() {
    if (!existsSync(FOLLOWUPS_FILE)) return [];
    const entries: Array<{ num: number; appNum: number; date: string; company: string; role: string; channel: string; contact: string; notes: string }> = [];
    for (const line of readFileSync(FOLLOWUPS_FILE, 'utf-8').split('\n')) {
      if (!line.startsWith('|')) continue;
      const p = line.split('|').map((s) => s.trim());
      if (p.length < 8) continue;
      const num = parseInt(p[1]);
      if (isNaN(num)) continue;
      entries.push({ num, appNum: parseInt(p[2]), date: p[3], company: p[4], role: p[5], channel: p[6], contact: p[7], notes: p[8] ?? '' });
    }
    return entries;
  }
}
