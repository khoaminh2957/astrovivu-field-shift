/**
 * Job summary of a CI run: test totals, the slowest test files, and the size of the build.
 * Reads `reports/junit.xml` (vitest's JUnit reporter) and `dist/`, and prints Markdown; in GitHub
 * Actions it goes to the run's summary page. It reports and never fails the job: an input that is
 * missing (a step before it failed) is written as "not available".
 *
 *   npx tsx scripts/ci/summary.ts
 */
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

export interface SuiteResult {
  name: string;
  tests: number;
  failures: number;
  skipped: number;
  seconds: number;
}

const attr = (tag: string, name: string): string => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? '';

/** One entry per test file of a JUnit report. */
export function junitSuites(xml: string): SuiteResult[] {
  return (xml.match(/<testsuite\b[^>]*>/g) ?? []).map((tag) => ({
    name: attr(tag, 'name'),
    tests: Number(attr(tag, 'tests')),
    failures: Number(attr(tag, 'failures')) + Number(attr(tag, 'errors')),
    skipped: Number(attr(tag, 'skipped') || 0),
    seconds: Number(attr(tag, 'time')),
  }));
}

export interface BuiltFile {
  file: string;
  bytes: number;
  gzipBytes: number;
}

/** Scripts and stylesheets of the build, largest first: what a visitor downloads before the app starts. */
export function builtFiles(dist: string): BuiltFile[] {
  const out: BuiltFile[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) walk(file);
      else if (/\.(js|css)$/.test(name)) {
        const content = readFileSync(file);
        out.push({ file: path.relative(dist, file).replaceAll(path.sep, '/'), bytes: content.length, gzipBytes: gzipSync(content).length });
      }
    }
  };
  walk(dist);
  return out.sort((a, b) => b.bytes - a.bytes);
}

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(0)} kB`;

export function summary(junit: string | null, dist: BuiltFile[] | null): string {
  const lines: string[] = ['### Tests', ''];
  if (junit == null) lines.push('Not available: the test step did not write a report.');
  else {
    const suites = junitSuites(junit);
    const total = (key: 'tests' | 'failures' | 'skipped' | 'seconds'): number => suites.reduce((sum, s) => sum + s[key], 0);
    lines.push(`${total('tests')} tests in ${suites.length} files: ${total('failures')} failed, ${total('skipped')} skipped, ${total('seconds').toFixed(1)} s of test time.`, '');
    const failed = suites.filter((s) => s.failures > 0);
    if (failed.length) lines.push('Failed files:', '', ...failed.map((s) => `- \`${s.name}\` (${s.failures} of ${s.tests})`), '');
    lines.push('| Slowest test files | Tests | Seconds |', '|---|---:|---:|');
    for (const s of [...suites].sort((a, b) => b.seconds - a.seconds).slice(0, 5)) lines.push(`| \`${s.name}\` | ${s.tests} | ${s.seconds.toFixed(2)} |`);
  }
  lines.push('', '### Build', '');
  if (dist == null) lines.push('Not available: there is no `dist/` folder.');
  else {
    lines.push('| File | Size | Gzip |', '|---|---:|---:|');
    for (const f of dist.slice(0, 10)) lines.push(`| \`${f.file}\` | ${kb(f.bytes)} | ${kb(f.gzipBytes)} |`);
    lines.push(`| **${dist.length} scripts and stylesheets** | **${kb(dist.reduce((s, f) => s + f.bytes, 0))}** | **${kb(dist.reduce((s, f) => s + f.gzipBytes, 0))}** |`);
  }
  return `${lines.join('\n')}\n`;
}

function main(): void {
  const junit = existsSync('reports/junit.xml') ? readFileSync('reports/junit.xml', 'utf8') : null;
  const dist = existsSync('dist') ? builtFiles('dist') : null;
  const text = summary(junit, dist);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  else console.log(text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
