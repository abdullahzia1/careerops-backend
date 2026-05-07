import { Injectable } from '@nestjs/common';
import { readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';

const ROOT = resolve(__dirname, '../../');
const APPS_FILE = existsSync(join(ROOT, 'data/applications.md'))
  ? join(ROOT, 'data/applications.md')
  : join(ROOT, 'applications.md');
const REPORTS_DIR = join(ROOT, 'reports');

// ── Types────────

export interface ScoreStats {
  avg: number;
  min: number;
  max: number;
  count: number;
}

export interface ArchetypeEntry {
  archetype: string;
  total: number;
  positive: number;
  negative: number;
  self_filtered: number;
  pending: number;
  conversionRate: number;
}

export interface BlockerEntry {
  blocker: string;
  frequency: number;
  percentage: number;
}

export interface RemotePolicyEntry {
  policy: string;
  total: number;
  positive: number;
  negative: number;
  self_filtered: number;
  pending: number;
  conversionRate: number;
}

export interface CompanySizeEntry {
  size: string;
  total: number;
  positive: number;
  negative: number;
  self_filtered: number;
  pending: number;
  conversionRate: number;
}

export interface TechGap {
  skill: string;
  frequency: number;
}

export interface Recommendation {
  action: string;
  reasoning: string;
  impact: 'high' | 'medium' | 'low';
}

export interface PatternsResult {
  metadata: {
    total: number;
    dateRange: { from: string | undefined; to: string | undefined };
    analysisDate: string;
    byOutcome: {
      positive: number;
      negative: number;
      self_filtered: number;
      pending: number;
    };
  };
  funnel: Record<string, number>;
  scoreComparison: Record<string, ScoreStats>;
  archetypeBreakdown: ArchetypeEntry[];
  blockerAnalysis: BlockerEntry[];
  remotePolicy: RemotePolicyEntry[];
  companySizeBreakdown: CompanySizeEntry[];
  scoreThreshold: { recommended: number; reasoning: string; positiveRange: string };
  techStackGaps: TechGap[];
  recommendations: Recommendation[];
}

export interface PatternsError {
  error: string;
  current?: number;
  threshold?: number;
}

// ── Status normalization

const ALIASES: Record<string, string> = {
  evaluada: 'evaluated', condicional: 'evaluated', hold: 'evaluated',
  evaluar: 'evaluated', verificar: 'evaluated',
  aplicado: 'applied', enviada: 'applied', aplicada: 'applied',
  applied: 'applied', sent: 'applied',
  respondido: 'responded',
  entrevista: 'interview',
  oferta: 'offer',
  rechazado: 'rejected', rechazada: 'rejected',
  descartado: 'discarded', descartada: 'discarded',
  cerrada: 'discarded', cancelada: 'discarded',
  'no aplicar': 'skip', no_aplicar: 'skip', monitor: 'skip', 'geo blocker': 'skip',
};

function normalizeStatus(raw: string): string {
  const clean = raw.replace(/\*\*/g, '').trim().toLowerCase()
    .replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();
  return ALIASES[clean] ?? clean;
}

function classifyOutcome(status: string): 'positive' | 'negative' | 'self_filtered' | 'pending' {
  const s = normalizeStatus(status);
  if (['interview', 'offer', 'responded', 'applied'].includes(s)) return 'positive';
  if (['rejected', 'discarded'].includes(s)) return 'negative';
  if (['skip'].includes(s)) return 'self_filtered';
  return 'pending';
}

// ── Report parsing──────

interface ReportData {
  archetype: string | null;
  seniority: string | null;
  remote: string | null;
  teamSize: string | null;
  comp: string | null;
  domain: string | null;
  scores: Record<string, number>;
  gaps: Array<{ description: string; severity: string; mitigation: string }>;
}

function parseReport(reportPath: string): ReportData | null {
  if (!existsSync(reportPath)) return null;
  const content = readFileSync(reportPath, 'utf-8');
  const plain = content.replace(/\*\*/g, '');

  const match = <T>(re: RegExp): T | null => {
    const m = plain.match(re);
    return m ? (m[1].trim() as unknown as T) : null;
  };

  const report: ReportData = {
    archetype: match(/\|\s*(?:Archetype|Arquetipo)\s*\|\s*(.*?)\s*\|/i),
    seniority: match(/\|\s*(?:Seniority|Nivel|Level)\s*\|\s*(.*?)\s*\|/i),
    remote: match(/\|\s*(?:Remote|Remoto|Location)\s*\|\s*(.*?)\s*\|/i),
    teamSize: match(/\|\s*(?:Team|Team size|Equipo)\s*\|\s*(.*?)\s*\|/i),
    comp: match(/\|\s*(?:Comp|Salary|Salario|Listed salary)\s*\|\s*(.*?)\s*\|/i),
    domain: match(/\|\s*(?:Domain|Dominio|Industry)\s*\|\s*(.*?)\s*\|/i),
    scores: {},
    gaps: [],
  };

  const scoreMap: Array<[RegExp, string]> = [
    [/\|\s*(?:CV Match|Match con CV)\s*\|\s*([\d.]+)\/5\s*\|/i, 'cvMatch'],
    [/\|\s*(?:North Star)\s*\|\s*([\d.]+)\/5\s*\|/i, 'northStar'],
    [/\|\s*(?:Comp)\s*\|\s*([\d.]+)\/5\s*\|/i, 'comp'],
    [/\|\s*(?:Cultural signals|Cultural)\s*\|\s*([\d.]+)\/5\s*\|/i, 'cultural'],
    [/\|\s*(?:Red flags)\s*\|\s*([-+]?[\d.]+)\s*\|/i, 'redFlags'],
    [/\|\s*(?:Global)\s*\|\s*([\d.]+)\/5\s*\|/i, 'global'],
  ];
  for (const [re, key] of scoreMap) {
    const m = plain.match(re);
    if (m) report.scores[key] = parseFloat(m[1]);
  }

  const gapTableMatch = content.match(
    /\|\s*Gap\s*\|\s*Severity\s*\|.*?\n\|[-|\s]+\n([\s\S]*?)(?:\n\n|\n##|\n\*\*|$)/i,
  );
  if (gapTableMatch) {
    const rows = gapTableMatch[1].split('\n').filter((r) => r.startsWith('|'));
    for (const row of rows) {
      const cols = row.split('|').map((s) => s.trim()).filter(Boolean);
      if (cols.length >= 2) {
        report.gaps.push({
          description: cols[0],
          severity: cols[1].toLowerCase(),
          mitigation: cols[2] ?? '',
        });
      }
    }
  }

  return report;
}

// ── Classification helpers────────

function classifyRemote(raw: string | null): string {
  if (!raw) return 'unknown';
  const lower = raw.toLowerCase();
  if (/\b(us[- ]?only|canada[- ]?only|residents only|usa only|us residents|canada residents)\b/.test(lower)) return 'geo-restricted';
  if (/\bargentina\s+remote\s+only\b/.test(lower)) return 'geo-restricted';
  if (/\b(hybrid|on-?site|office|columbus|cape town|relocat)\b/.test(lower)) return 'hybrid/onsite';
  if (/\b(global|anywhere|worldwide|no restrict|70\+|work from anywhere)\b/.test(lower)) return 'global remote';
  if (/\b(remote|latam|americas|brazil|fully remote)\b/.test(lower)) return 'regional remote';
  return 'unknown';
}

function classifyCompanySize(teamSize: string | null): string {
  if (!teamSize) return 'unknown';
  const lower = teamSize.toLowerCase();
  const nums = lower.match(/[\d,]+/g);
  if (nums) {
    const max = Math.max(...nums.map((n) => parseInt(n.replace(/,/g, ''))));
    if (max <= 50) return 'startup';
    if (max <= 500) return 'scaleup';
    return 'enterprise';
  }
  if (/\b(small|elite|tiny|founding)\b/.test(lower)) return 'startup';
  if (/\b(large|enterprise|global)\b/.test(lower)) return 'enterprise';
  return 'unknown';
}

function extractBlockerType(gap: { description: string; severity: string }): string | null {
  const desc = gap.description.toLowerCase();
  const sev = gap.severity.toLowerCase();
  if (sev.includes('nice') || sev.includes('soft')) return null;
  if (/\b(residency|us[- ]only|canada|location|visa|geo|country|region)\b/.test(desc)) return 'geo-restriction';
  if (/\b(javascript|typescript|python|ruby|java|go|rust|node|react|angular|vue|django|flask|rails)\b/.test(desc)) return 'stack-mismatch';
  if (/\b(senior|staff|lead|principal|director|manager|head)\b/.test(desc)) return 'seniority-mismatch';
  if (/\b(hybrid|on-?site|office|relocat)\b/.test(desc)) return 'onsite-requirement';
  return 'other';
}

@Injectable()
export class PatternsService {
  analyze(minThreshold = 5): PatternsResult | PatternsError {
    const entries = this.parseTracker();

    if (entries.length === 0) {
      return { error: 'No applications found in tracker.' };
    }

    const enriched = entries.map((e) => {
      const reportMatch = e.report.match(/\]\(([^)]+)\)/);
      const reportPath = reportMatch ? join(ROOT, reportMatch[1]) : null;
      const reportData = reportPath ? parseReport(reportPath) : null;
      const outcome = classifyOutcome(e.status);
      const score = parseFloat(e.score) || 0;
      const remoteSource = reportData?.remote ?? e.notes ?? '';
      return {
        ...e,
        normalizedStatus: normalizeStatus(e.status),
        outcome,
        score,
        reportData,
        remoteBucket: classifyRemote(remoteSource),
        companySize: classifyCompanySize(reportData?.teamSize ?? null),
      };
    });

    const beyondEvaluated = enriched.filter((e) => e.normalizedStatus !== 'evaluated');
    if (beyondEvaluated.length < minThreshold) {
      return {
        error: `Not enough data: ${beyondEvaluated.length}/${minThreshold} applications beyond "Evaluated". Keep applying and come back later.`,
        current: beyondEvaluated.length,
        threshold: minThreshold,
      };
    }

    // Funnel
    const funnel: Record<string, number> = {};
    for (const e of enriched) {
      funnel[e.normalizedStatus] = (funnel[e.normalizedStatus] || 0) + 1;
    }

    // Score stats
    const scoresByOutcome: Record<string, number[]> = { positive: [], negative: [], self_filtered: [], pending: [] };
    for (const e of enriched) {
      if (e.score > 0) scoresByOutcome[e.outcome].push(e.score);
    }
    const scoreStats = (arr: number[]): ScoreStats => {
      if (arr.length === 0) return { avg: 0, min: 0, max: 0, count: 0 };
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
      return { avg: Math.round(avg * 100) / 100, min: Math.min(...arr), max: Math.max(...arr), count: arr.length };
    };
    const scoreComparison: Record<string, ScoreStats> = {
      positive: scoreStats(scoresByOutcome.positive),
      negative: scoreStats(scoresByOutcome.negative),
      self_filtered: scoreStats(scoresByOutcome.self_filtered),
      pending: scoreStats(scoresByOutcome.pending),
    };

    // Archetype breakdown
    const archetypeMap = new Map<string, ArchetypeEntry>();
    for (const e of enriched) {
      const arch = e.reportData?.archetype ?? 'Unknown';
      if (!archetypeMap.has(arch)) {
        archetypeMap.set(arch, { archetype: arch, total: 0, positive: 0, negative: 0, self_filtered: 0, pending: 0, conversionRate: 0 });
      }
      const entry = archetypeMap.get(arch)!;
      entry.total++;
      (entry as unknown as Record<string, number>)[e.outcome]++;
    }
    const archetypeBreakdown = [...archetypeMap.values()]
      .map((a) => ({ ...a, conversionRate: a.total > 0 ? Math.round((a.positive / a.total) * 100) : 0 }))
      .sort((a, b) => b.total - a.total);

    // Blocker analysis
    const blockerCounts = new Map<string, number>();
    for (const e of enriched) {
      if (!e.reportData?.gaps) continue;
      for (const gap of e.reportData.gaps) {
        const type = extractBlockerType(gap);
        if (!type) continue;
        blockerCounts.set(type, (blockerCounts.get(type) || 0) + 1);
      }
    }
    const blockerAnalysis: BlockerEntry[] = [...blockerCounts.entries()]
      .map(([blocker, frequency]) => ({
        blocker,
        frequency,
        percentage: Math.round((frequency / enriched.length) * 100),
      }))
      .sort((a, b) => b.frequency - a.frequency);

    // Remote policy breakdown
    const remoteMap = new Map<string, RemotePolicyEntry>();
    for (const e of enriched) {
      const policy = e.remoteBucket;
      if (!remoteMap.has(policy)) {
        remoteMap.set(policy, { policy, total: 0, positive: 0, negative: 0, self_filtered: 0, pending: 0, conversionRate: 0 });
      }
      const entry = remoteMap.get(policy)!;
      entry.total++;
      (entry as unknown as Record<string, number>)[e.outcome]++;
    }
    const remotePolicy = [...remoteMap.values()]
      .map((r) => ({ ...r, conversionRate: r.total > 0 ? Math.round((r.positive / r.total) * 100) : 0 }))
      .sort((a, b) => b.total - a.total);

    // Company size breakdown
    const sizeMap = new Map<string, CompanySizeEntry>();
    for (const e of enriched) {
      const size = e.companySize;
      if (!sizeMap.has(size)) {
        sizeMap.set(size, { size, total: 0, positive: 0, negative: 0, self_filtered: 0, pending: 0, conversionRate: 0 });
      }
      const entry = sizeMap.get(size)!;
      entry.total++;
      (entry as unknown as Record<string, number>)[e.outcome]++;
    }
    const companySizeBreakdown = [...sizeMap.values()]
      .map((s) => ({ ...s, conversionRate: s.total > 0 ? Math.round((s.positive / s.total) * 100) : 0 }))
      .sort((a, b) => b.total - a.total);

    // Score threshold
    const positiveScores = scoresByOutcome.positive.filter((s) => s > 0);
    const minPositiveScore = positiveScores.length > 0 ? Math.min(...positiveScores) : 0;
    const scoreThreshold = {
      recommended: minPositiveScore > 0 ? Math.floor(minPositiveScore * 10) / 10 : 3.5,
      reasoning: positiveScores.length > 0
        ? `Lowest score among positive outcomes is ${minPositiveScore}. No applications below this score led to progress.`
        : 'Not enough positive outcome data to determine threshold.',
      positiveRange: positiveScores.length > 0
        ? `${Math.min(...positiveScores)} - ${Math.max(...positiveScores)}`
        : 'N/A',
    };

    // Tech stack gaps
    const stackGapCounts = new Map<string, number>();
    for (const e of enriched) {
      if (e.outcome !== 'negative' && e.outcome !== 'self_filtered') continue;
      if (!e.reportData?.gaps) continue;
      for (const gap of e.reportData.gaps) {
        const techs = gap.description.match(
          /\b(JavaScript|TypeScript|Python|Ruby|Java|Go|Rust|Node\.?js|React|Angular|Vue\.?js|Django|Flask|Rails|PHP|Laravel|Symfony|Kotlin|Swift|C\+\+|C#|\.NET|MongoDB|MySQL|PostgreSQL|Redis|GraphQL|REST|AWS|GCP|Azure|Docker|Kubernetes|Terraform|Supabase|Inngest|React Native)\b/gi,
        );
        if (techs) {
          for (const tech of techs) {
            const normalized = tech.charAt(0).toUpperCase() + tech.slice(1);
            stackGapCounts.set(normalized, (stackGapCounts.get(normalized) || 0) + 1);
          }
        }
      }
    }
    const techStackGaps: TechGap[] = [...stackGapCounts.entries()]
      .map(([skill, frequency]) => ({ skill, frequency }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 15);

    // Recommendations
    const recommendations: Recommendation[] = [];

    const geoBlocker = blockerAnalysis.find((b) => b.blocker === 'geo-restriction');
    if (geoBlocker && geoBlocker.percentage >= 20) {
      recommendations.push({
        action: `Tighten location filters in portals.yml — ${geoBlocker.percentage}% of applications hit a geo-restriction blocker`,
        reasoning: `${geoBlocker.frequency} of ${enriched.length} offers are location-restricted (US/Canada-only). These are wasted evaluation effort.`,
        impact: 'high',
      });
    }

    const stackBlocker = blockerAnalysis.find((b) => b.blocker === 'stack-mismatch');
    if (stackBlocker && stackBlocker.percentage >= 15) {
      const topGaps = techStackGaps.slice(0, 3).map((g) => g.skill).join(', ');
      recommendations.push({
        action: `Filter out roles requiring ${topGaps} as primary stack — ${stackBlocker.percentage}% hit stack mismatch`,
        reasoning: `Core stack gaps (${topGaps}) are the most common technical blockers in negative outcomes.`,
        impact: 'high',
      });
    }

    if (minPositiveScore > 3.0) {
      recommendations.push({
        action: `Set minimum score threshold at ${scoreThreshold.recommended}/5 before generating PDFs`,
        reasoning: `No positive outcomes below ${minPositiveScore}/5. Scores below this are wasted effort.`,
        impact: 'medium',
      });
    }

    const bestArchetype = archetypeBreakdown
      .filter((a) => a.total >= 2)
      .sort((a, b) => b.conversionRate - a.conversionRate)[0];
    if (bestArchetype && bestArchetype.conversionRate > 0) {
      recommendations.push({
        action: `Double down on "${bestArchetype.archetype}" roles (${bestArchetype.conversionRate}% conversion rate)`,
        reasoning: `${bestArchetype.positive} of ${bestArchetype.total} applications in this archetype led to positive outcomes.`,
        impact: 'medium',
      });
    }

    const worstRemote = remotePolicy.filter((r) => r.total >= 2 && r.conversionRate === 0)[0];
    if (worstRemote) {
      recommendations.push({
        action: `Avoid "${worstRemote.policy}" roles (0% conversion across ${worstRemote.total} applications)`,
        reasoning: `None of the ${worstRemote.total} applications with "${worstRemote.policy}" policy led to progress.`,
        impact: 'medium',
      });
    }

    const dates = enriched.map((e) => e.date).filter(Boolean).sort();

    return {
      metadata: {
        total: enriched.length,
        dateRange: { from: dates[0], to: dates[dates.length - 1] },
        analysisDate: new Date().toISOString().split('T')[0],
        byOutcome: {
          positive: enriched.filter((e) => e.outcome === 'positive').length,
          negative: enriched.filter((e) => e.outcome === 'negative').length,
          self_filtered: enriched.filter((e) => e.outcome === 'self_filtered').length,
          pending: enriched.filter((e) => e.outcome === 'pending').length,
        },
      },
      funnel,
      scoreComparison,
      archetypeBreakdown,
      blockerAnalysis,
      remotePolicy,
      companySizeBreakdown,
      scoreThreshold,
      techStackGaps,
      recommendations,
    };
  }

  // ── Private───

  private parseTracker(): Array<{
    num: number; date: string; company: string; role: string;
    score: string; status: string; pdf: string; report: string; notes: string;
  }> {
    if (!existsSync(APPS_FILE)) return [];
    const content = readFileSync(APPS_FILE, 'utf-8');
    const entries = [];
    for (const line of content.split('\n')) {
      if (!line.startsWith('|')) continue;
      const parts = line.split('|').map((s) => s.trim());
      if (parts.length < 9) continue;
      const num = parseInt(parts[1]);
      if (isNaN(num)) continue;
      entries.push({
        num, date: parts[2], company: parts[3], role: parts[4],
        score: parts[5], status: parts[6], pdf: parts[7], report: parts[8],
        notes: parts[9] ?? '',
      });
    }
    return entries;
  }
}
