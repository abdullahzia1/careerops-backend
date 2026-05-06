import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { CvVersion, EvaluationJob, ProfileSnapshot } from '../types/api';

@Injectable()
export class StoreService {
  private activeCvVersionId: string | null = null;
  private activeProfileSnapshotId: string | null = null;
  private readonly cvVersions = new Map<string, CvVersion>();
  private readonly profileSnapshots = new Map<string, ProfileSnapshot>();
  private readonly jobs = new Map<string, EvaluationJob>();

  constructor() {
    this.seedDemoCv();
  }

  private isoNow(): string {
    return new Date().toISOString();
  }

  private seedDemoCv(): void {
    const id = randomUUID();
    const row: CvVersion = {
      id,
      etag: `"${id.slice(0, 8)}"`,
      content: '# Your CV\n\nReplace with your markdown resume.',
      createdAt: this.isoNow(),
    };
    this.cvVersions.set(id, row);
    this.activeCvVersionId = id;
  }

  // ── CV ─────────────────────────────────────────────────────────────────────

  listCvVersions(): CvVersion[] {
    return [...this.cvVersions.values()].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    );
  }

  getActiveCvPointers(): { activeCvVersionId: string | null } {
    return { activeCvVersionId: this.activeCvVersionId };
  }

  getActiveCvContent(): string | null {
    if (!this.activeCvVersionId) return null;
    return this.cvVersions.get(this.activeCvVersionId)?.content ?? null;
  }

  patchCvMarkdown(
    content: string,
    ifMatch?: string | null,
  ):
    | { ok: true; version: CvVersion }
    | { ok: false; reason: 'precondition_failed' } {
    const current =
      this.activeCvVersionId !== null
        ? this.cvVersions.get(this.activeCvVersionId)
        : undefined;

    if (ifMatch) {
      if (!current || ifMatch !== current.etag) {
        return { ok: false, reason: 'precondition_failed' };
      }
    }

    const id = randomUUID();
    const etag = `"${randomUUID().slice(0, 16)}"`;
    const version: CvVersion = { id, etag, content, createdAt: this.isoNow() };
    this.cvVersions.set(id, version);
    this.activeCvVersionId = id;
    return { ok: true, version };
  }

  // ── Profile ────────────────────────────────────────────────────────────────

  listProfileSnapshots(): ProfileSnapshot[] {
    return [...this.profileSnapshots.values()].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    );
  }

  activeProfilePointers(): { activeProfileSnapshotId: string | null } {
    return { activeProfileSnapshotId: this.activeProfileSnapshotId };
  }

  patchProfileSnapshot(
    data: Record<string, unknown>,
    ifMatch?: string | null,
  ):
    | { ok: true; snapshot: ProfileSnapshot }
    | { ok: false; reason: 'precondition_failed' } {
    const current =
      this.activeProfileSnapshotId !== null
        ? this.profileSnapshots.get(this.activeProfileSnapshotId)
        : undefined;

    if (ifMatch) {
      if (!current || ifMatch !== current.etag) {
        return { ok: false, reason: 'precondition_failed' };
      }
    }

    const id = randomUUID();
    const etag = `"${randomUUID().slice(0, 16)}"`;
    const snapshot: ProfileSnapshot = { id, etag, data, createdAt: this.isoNow() };
    this.profileSnapshots.set(id, snapshot);
    this.activeProfileSnapshotId = id;
    return { ok: true, snapshot };
  }

  // ── Jobs ───────────────────────────────────────────────────────────────────

  enqueueEvaluation(input: {
    jdText?: string;
    sourceUrl?: string;
    cvVersionId?: string;
    profileSnapshotId?: string;
  }): EvaluationJob | { error: string } {
    const jdFull = (input.jdText ?? input.sourceUrl ?? '').trim();
    if (!jdFull) return { error: 'Provide jdText or sourceUrl.' };

    const now = this.isoNow();
    const job: EvaluationJob = {
      id: randomUUID(),
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      jdPreview: jdFull.slice(0, 280),
      jdFull,
      cvVersionId: input.cvVersionId ?? this.activeCvVersionId ?? null,
      profileSnapshotId:
        input.profileSnapshotId ?? this.activeProfileSnapshotId ?? null,
      reportMarkdown: null,
      score: null,
      company: null,
      role: null,
      archetype: null,
      legitimacy: null,
      errorMessage: null,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  listJobs(): EvaluationJob[] {
    return [...this.jobs.values()].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    );
  }

  getJob(id: string): EvaluationJob | undefined {
    return this.jobs.get(id);
  }

  // ── Worker helpers ─────────────────────────────────────────────────────────

  claimNextQueuedJob(): EvaluationJob | undefined {
    return [...this.jobs.values()]
      .filter((j) => j.status === 'queued')
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))[0];
  }

  markJobRunning(id: string): void {
    const job = this.jobs.get(id);
    if (job)
      this.jobs.set(id, { ...job, status: 'running', updatedAt: this.isoNow() });
  }

  resolveJob(
    id: string,
    result: {
      reportMarkdown: string;
      score: number | null;
      company: string | null;
      role: string | null;
      archetype: string | null;
      legitimacy: string | null;
    },
  ): void {
    const job = this.jobs.get(id);
    if (job)
      this.jobs.set(id, {
        ...job,
        status: 'succeeded',
        updatedAt: this.isoNow(),
        ...result,
      });
  }

  failJob(id: string, errorMessage: string): void {
    const job = this.jobs.get(id);
    if (job)
      this.jobs.set(id, {
        ...job,
        status: 'failed',
        updatedAt: this.isoNow(),
        errorMessage,
      });
  }
}
