import { Injectable, Logger } from '@nestjs/common';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { chromium } from 'playwright';
import * as yaml from 'js-yaml';
import { StoreService } from '../store/store.service';

const ROOT = resolve(__dirname, '../../');
const TEMPLATE_PATH = resolve(ROOT, 'templates/cv-template.html');
const FONTS_DIR = resolve(ROOT, 'fonts');
const PROFILE_PATH = resolve(ROOT, 'config/profile.yml');
const CV_PATH = resolve(ROOT, 'cv.md');
const OUTPUT_DIR = resolve(ROOT, 'output');

export type PdfFormat = 'a4' | 'letter';

export interface GeneratePdfResult {
  buffer: Buffer;
  pageCount: number;
  sizeKb: number;
  atsReplacements: number;
}

interface ProfileYml {
  candidate?: {
    full_name?: string;
    email?: string;
    phone?: string;
    location?: string;
    linkedin?: string;
    portfolio_url?: string;
  };
}

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  constructor(private readonly storeService: StoreService) {}

  /**
   * Generate PDF from raw pre-built HTML.
   * Used when the caller (frontend or AI flow) provides fully assembled HTML.
   */
  async generateFromHtml(html: string, format: PdfFormat = 'a4'): Promise<GeneratePdfResult> {
    const patched = this.patchFontPaths(html);
    const { html: normalized, count: atsReplacements } = this.normalizeTextForATS(patched);
    return this.renderWithPlaywright(normalized, format, atsReplacements);
  }

  /**
   * Generate PDF from the active CV markdown + profile.yml.
   * Reads the latest CV from the in-memory store (or disk fallback),
   * fills the HTML template, and renders via Playwright.
   */
  async generateFromProfile(format: PdfFormat = 'a4'): Promise<GeneratePdfResult> {
    if (!existsSync(TEMPLATE_PATH)) {
      throw new Error('cv-template.html not found — expected at templates/cv-template.html');
    }

    const cvMarkdown = this.getActiveCv();
    const profile = this.readProfile();
    const html = this.buildHtmlFromTemplate(cvMarkdown, profile);
    return this.generateFromHtml(html, format);
  }

  /**
   * Save the generated PDF buffer to output/{filename}.
   * Returns the absolute path of the saved file.
   */
  savePdf(buffer: Buffer, filename: string): string {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    const outputPath = resolve(OUTPUT_DIR, filename);
    writeFileSync(outputPath, buffer);
    return outputPath;
  }

  // ── Private ──────────────────────────────────────────────────────────

  private getActiveCv(): string {
    const versions = this.storeService.listCvVersions();
    const latest = versions[versions.length - 1];
    if (latest) return latest.content;
    if (existsSync(CV_PATH)) return readFileSync(CV_PATH, 'utf-8');
    throw new Error('No CV found. Upload a CV via /api/v1/me first.');
  }

  private readProfile(): ProfileYml {
    if (!existsSync(PROFILE_PATH)) return {};
    try {
      return yaml.load(readFileSync(PROFILE_PATH, 'utf-8')) as ProfileYml;
    } catch {
      return {};
    }
  }

  private buildHtmlFromTemplate(cvMarkdown: string, profile: ProfileYml): string {
    const candidate = profile.candidate ?? {};

    const sections = this.parseCvSections(cvMarkdown);

    let html = readFileSync(TEMPLATE_PATH, 'utf-8');

    const linkedinUrl = candidate.linkedin
      ? candidate.linkedin.startsWith('http')
        ? candidate.linkedin
        : `https://${candidate.linkedin}`
      : '';
    const linkedinDisplay = linkedinUrl.replace(/^https?:\/\//, '');

    const portfolioUrl = candidate.portfolio_url ?? '';
    const portfolioDisplay = portfolioUrl.replace(/^https?:\/\//, '');

    const replacements: Record<string, string> = {
      '{{LANG}}': 'en',
      '{{NAME}}': candidate.full_name ?? 'Your Name',
      '{{PAGE_WIDTH}}': '210mm',
      '{{PHONE}}': candidate.phone ?? '',
      '{{EMAIL}}': candidate.email ?? '',
      '{{LINKEDIN_URL}}': linkedinUrl,
      '{{LINKEDIN_DISPLAY}}': linkedinDisplay,
      '{{PORTFOLIO_URL}}': portfolioUrl,
      '{{PORTFOLIO_DISPLAY}}': portfolioDisplay,
      '{{LOCATION}}': candidate.location ?? '',
      '{{SECTION_SUMMARY}}': 'Professional Summary',
      '{{SUMMARY_TEXT}}': sections.summary ?? '',
      '{{SECTION_COMPETENCIES}}': 'Core Competencies',
      '{{COMPETENCIES}}': sections.skills ?? sections.competencies ?? '',
      '{{SECTION_EXPERIENCE}}': 'Work Experience',
      '{{EXPERIENCE}}': sections.experience ?? '',
      '{{SECTION_PROJECTS}}': 'Projects',
      '{{PROJECTS}}': sections.projects ?? '',
      '{{SECTION_EDUCATION}}': 'Education',
      '{{EDUCATION}}': sections.education ?? '',
      '{{SECTION_CERTIFICATIONS}}': 'Certifications',
      '{{CERTIFICATIONS}}': sections.certifications ?? '',
      '{{SECTION_SKILLS}}': 'Skills',
      '{{SKILLS}}': sections.skills ?? '',
    };

    for (const [token, value] of Object.entries(replacements)) {
      html = html.split(token).join(value);
    }

    return this.patchFontPaths(html);
  }

  /**
   * Parse CV markdown into named sections.
   * Sections are delimited by ## headings.
   * Content is converted from markdown to HTML using a simple inline renderer.
   */
  private parseCvSections(markdown: string): Record<string, string> {
    const sections: Record<string, string> = {};
    const lines = markdown.split('\n');
    let currentSection = '';
    const buffer: string[] = [];

    const flush = () => {
      if (currentSection && buffer.length > 0) {
        sections[currentSection] = this.markdownToHtml(buffer.join('\n').trim());
        buffer.length = 0;
      }
    };

    for (const line of lines) {
      const h2 = line.match(/^##\s+(.+)/);
      if (h2) {
        flush();
        currentSection = h2[1].toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        continue;
      }
      if (currentSection) buffer.push(line);
    }
    flush();

    // Alias common heading names
    const aliasMap: Record<string, string[]> = {
      experience: ['work-experience', 'professional-experience', 'employment'],
      education: ['academic-background'],
      skills: ['technical-skills', 'technologies', 'competencies', 'core-competencies'],
      projects: ['portfolio', 'side-projects', 'open-source'],
      certifications: ['certificates', 'credentials'],
      summary: ['professional-summary', 'about', 'profile'],
    };
    for (const [canonical, aliases] of Object.entries(aliasMap)) {
      if (!sections[canonical]) {
        for (const alias of aliases) {
          if (sections[alias]) {
            sections[canonical] = sections[alias];
            break;
          }
        }
      }
    }

    return sections;
  }

  /** Minimal markdown → HTML conversion (headings, bold, bullets, links). */
  private markdownToHtml(md: string): string {
    let html = md
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');

    // Convert bullet lists to <ul><li>
    html = html.replace(/((?:^[-*+] .+\n?)+)/gm, (block) => {
      const items = block.trim().split('\n').map((l) =>
        `<li>${l.replace(/^[-*+] /, '').trim()}</li>`,
      );
      return `<ul>${items.join('')}</ul>`;
    });

    // Wrap remaining plain paragraphs
    html = html
      .split(/\n{2,}/)
      .map((para) => {
        const trimmed = para.trim();
        if (!trimmed) return '';
        if (/^<[hul]/.test(trimmed)) return trimmed;
        return `<p>${trimmed.replace(/\n/g, ' ')}</p>`;
      })
      .filter(Boolean)
      .join('\n');

    return html;
  }

  /** Rewrite relative ./fonts/ paths to absolute file:// paths for Playwright. */
  private patchFontPaths(html: string): string {
    return html
      .replace(/url\(['"]?\.\/fonts\//g, `url('file://${FONTS_DIR}/`)
      .replace(
        /file:\/\/([^'")]+)\.(woff2?|ttf|otf)['"]?\)/g,
        `file://$1.$2')`,
      );
  }

  /**
   * ATS normalization: replace em-dashes, smart quotes, zero-width chars, etc.
   * Only operates on body text — preserves CSS, JS, and HTML attributes.
   */
  private normalizeTextForATS(html: string): { html: string; count: number } {
    let totalCount = 0;

    const masks: string[] = [];
    const masked = html.replace(
      /<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi,
      (match) => {
        const token = `\u0000MASK${masks.length}\u0000`;
        masks.push(match);
        return token;
      },
    );

    const sanitize = (text: string): string => {
      if (!text) return text;
      const replacePairs: Array<[RegExp, string]> = [
        [/\u2014/g, '-'],  // em-dash
        [/\u2013/g, '-'],  // en-dash
        [/[\u201C\u201D\u201E\u201F]/g, '"'],  // smart double quotes
        [/[\u2018\u2019\u201A\u201B]/g, "'"],  // smart single quotes
        [/\u2026/g, '...'],  // ellipsis
        [/[\u200B\u200C\u200D\u2060\uFEFF]/g, ''],  // zero-width chars
        [/\u00A0/g, ' '],  // nbsp
      ];
      let t = text;
      for (const [re, replacement] of replacePairs) {
        const orig = t;
        t = t.replace(re, replacement);
        if (t !== orig) totalCount++;
      }
      return t;
    };

    let out = '';
    let i = 0;
    while (i < masked.length) {
      const lt = masked.indexOf('<', i);
      if (lt === -1) { out += sanitize(masked.slice(i)); break; }
      out += sanitize(masked.slice(i, lt));
      const gt = masked.indexOf('>', lt);
      if (gt === -1) { out += masked.slice(lt); break; }
      out += masked.slice(lt, gt + 1);
      i = gt + 1;
    }

    const restored = out.replace(/\u0000MASK(\d+)\u0000/g, (_, n) => masks[Number(n)]);
    return { html: restored, count: totalCount };
  }

  private async renderWithPlaywright(
    html: string,
    format: PdfFormat,
    atsReplacements: number,
  ): Promise<GeneratePdfResult> {
      const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ baseURL: `file://${dirname(TEMPLATE_PATH)}/` });
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);

      const pdfBuffer = await page.pdf({
        format,
        printBackground: true,
        margin: { top: '0.6in', right: '0.6in', bottom: '0.6in', left: '0.6in' },
        preferCSSPageSize: false,
      });

      const buffer = Buffer.from(pdfBuffer);
      const pdfString = buffer.toString('latin1');
      const pageCount = (pdfString.match(/\/Type\s*\/Page[^s]/g) || []).length;

      this.logger.log(`PDF generated: ${pageCount} pages, ${(buffer.length / 1024).toFixed(1)} KB, ${atsReplacements} ATS replacements`);

      return {
        buffer,
        pageCount,
        sizeKb: Math.round(buffer.length / 1024),
        atsReplacements,
      };
    } finally {
      await browser.close();
    }
  }
}
