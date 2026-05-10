import { Injectable, Logger } from '@nestjs/common';
import { existsSync, writeFileSync, readFileSync, mkdirSync, unlinkSync } from 'fs';
import { resolve, join, basename } from 'path';
import { execFileSync } from 'child_process';

const ROOT = resolve(__dirname, '../../');
const OUTPUT_DIR = join(ROOT, 'output');

// Files Tectonic / pdflatex can leave behind beside <base>.pdf
const ARTIFACT_EXTS = ['.tex', '.pdf', '.log', '.aux', '.out', '.toc', '.synctex.gz'];

const REQUIRED_SECTIONS = [
  '\\\\begin\\{document\\}', '\\\\end\\{document\\}',
  '\\\\documentclass', '\\\\begin\\{tikzpicture\\}|\\\\section|\\\\subsection|\\\\maketitle',
];

const PLACEHOLDER_RE = /\\{[A-Z_]+\\}|<[A-Z_\s]+>/g;

export interface LatexValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  placeholdersFound: string[];
  sectionsFound: string[];
}

export interface LatexCompileResult {
  success: boolean;
  message: string;
  pdfPath?: string;
  logSnippet?: string;
}

@Injectable()
export class LatexService {
  private readonly logger = new Logger(LatexService.name);

  validate(texContent: string): LatexValidation {
    const errors: string[] = [];
    const warnings: string[] = [];
    const sectionsFound: string[] = [];

    if (!texContent.includes('\\begin{document}')) errors.push('Missing \\begin{document}');
    if (!texContent.includes('\\end{document}')) errors.push('Missing \\end{document}');
    if (!texContent.includes('\\documentclass')) errors.push('Missing \\documentclass declaration');

    // Check for unresolved template placeholders
    const placeholdersFound = [...new Set(texContent.match(/\{\{[A-Z_]+\}\}|<[A-Z_\s]+>/g) ?? [])];
    if (placeholdersFound.length > 0) {
      warnings.push(`${placeholdersFound.length} unfilled placeholder(s) found: ${placeholdersFound.slice(0, 5).join(', ')}`);
    }

    // Identify structural sections present
    const sectionPatterns: Record<string, RegExp> = {
      'section': /\\section\{/,
      'subsection': /\\subsection\{/,
      'itemize/enumerate': /\\begin\{itemize\}|\\begin\{enumerate\}/,
      'tikzpicture': /\\begin\{tikzpicture\}/,
      'tabular': /\\begin\{tabular\}/,
      'geometry': /\\usepackage.*geometry/,
      'hyperref': /\\usepackage.*hyperref/,
    };
    for (const [name, re] of Object.entries(sectionPatterns)) {
      if (re.test(texContent)) sectionsFound.push(name);
    }

    // Check for common encoding issues
    if (/[^\x00-\x7F]/.test(texContent)) {
      warnings.push('Non-ASCII characters detected — ensure LaTeX encoding matches (\\usepackage[utf8]{inputenc})');
    }

    // Check balanced braces (rough estimate)
    const open = (texContent.match(/\{/g) ?? []).length;
    const close = (texContent.match(/\}/g) ?? []).length;
    if (Math.abs(open - close) > 5) {
      warnings.push(`Possible unbalanced braces: ${open} opening vs ${close} closing`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      placeholdersFound,
      sectionsFound,
    };
  }

  /**
   * Strip directory components, restrict to safe characters, and force a `.pdf` suffix.
   * Prevents path traversal via attacker-controlled filenames.
   */
  sanitizeFilename(raw: string | undefined | null): string {
    const fallback = `cv-${new Date().toISOString().slice(0, 10)}.pdf`;
    if (!raw) return fallback;
    const cleaned = basename(raw).replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
    if (!cleaned) return fallback;
    return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`;
  }

  /** Best-effort removal of every artifact tectonic / pdflatex may have produced. */
  cleanupArtifacts(pdfPath: string): void {
    const base = pdfPath.replace(/\.pdf$/, '');
    for (const ext of ARTIFACT_EXTS) {
      const p = `${base}${ext}`;
      try {
        if (existsSync(p)) unlinkSync(p);
      } catch (err) {
        this.logger.warn(`Failed to remove ${p}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  compile(texContent: string, outputFilename: string): LatexCompileResult {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    const safeName = this.sanitizeFilename(outputFilename);
    const texPath = join(OUTPUT_DIR, safeName.replace(/\.pdf$/, '.tex'));
    const pdfPath = join(OUTPUT_DIR, safeName);

    writeFileSync(texPath, texContent);
    this.logger.log(`Compiling ${texPath}`);

    // Try tectonic first (preferred), then pdflatex
    const failures: string[] = [];
    let bothMissing = true;

    for (const compiler of ['tectonic', 'pdflatex']) {
      try {
        if (compiler === 'tectonic') {
          execFileSync('tectonic', [texPath], { cwd: OUTPUT_DIR, timeout: 60_000, encoding: 'utf-8' });
        } else {
          execFileSync('pdflatex', ['-interaction=nonstopmode', '-output-directory', OUTPUT_DIR, texPath], {
            cwd: OUTPUT_DIR, timeout: 60_000, encoding: 'utf-8',
          });
          // Second pass for references
          execFileSync('pdflatex', ['-interaction=nonstopmode', '-output-directory', OUTPUT_DIR, texPath], {
            cwd: OUTPUT_DIR, timeout: 60_000, encoding: 'utf-8',
          });
        }

        if (existsSync(pdfPath)) {
          return { success: true, message: `Compiled with ${compiler}`, pdfPath };
        }
        bothMissing = false;
        failures.push(`${compiler}: process exited but no PDF was produced`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const isMissing = (err as NodeJS.ErrnoException)?.code === 'ENOENT' || /ENOENT/.test(msg);
        if (!isMissing) bothMissing = false;
        this.logger.warn(`${compiler} failed: ${msg}`);
        failures.push(`${compiler}: ${msg}`);
      }
    }

    // If both compilers were missing, surface the actionable message.
    if (bothMissing) {
      return {
        success: false,
        message:
          'Neither tectonic nor pdflatex found on PATH. Install Tectonic (brew install tectonic) ' +
          'or bake it into the deployment image (see careerops-backend/Dockerfile).',
      };
    }

    // Otherwise report the (real) compilation error, with a log snippet if available.
    const logPath = pdfPath.replace(/\.pdf$/, '.log');
    const logSnippet = existsSync(logPath)
      ? readFileSync(logPath, 'utf-8').split('\n').filter((l) => l.includes('!')).slice(0, 10).join('\n')
      : undefined;

    return {
      success: false,
      message: `Compilation failed: ${failures.join(' | ')}`,
      logSnippet,
    };
  }
}
