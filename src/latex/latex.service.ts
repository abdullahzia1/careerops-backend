import { Injectable, Logger } from '@nestjs/common';
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import { execFileSync } from 'child_process';

const ROOT = resolve(__dirname, '../../');
const OUTPUT_DIR = join(ROOT, 'output');

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

  compile(texContent: string, outputFilename: string): LatexCompileResult {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    const texPath = join(OUTPUT_DIR, outputFilename.replace(/\.pdf$/, '.tex'));
    const pdfPath = join(OUTPUT_DIR, outputFilename.replace(/\.tex$/, '.pdf'));

    writeFileSync(texPath, texContent);
    this.logger.log(`Compiling ${texPath}`);

    // Try tectonic first (preferred), then pdflatex
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
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`${compiler} failed: ${msg}`);
        // Read .log for snippet if pdflatex
        const logPath = pdfPath.replace(/\.pdf$/, '.log');
        const logSnippet = existsSync(logPath) ? readFileSync(logPath, 'utf-8').split('\n').filter((l) => l.includes('!')).slice(0, 10).join('\n') : undefined;
        if (compiler === 'pdflatex') {
          return { success: false, message: `Compilation failed: ${msg}`, logSnippet };
        }
      }
    }

    return { success: false, message: 'Neither tectonic nor pdflatex found on PATH. Install one to compile.' };
  }
}
