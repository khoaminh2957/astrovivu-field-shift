import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { builtFiles, junitSuites, summary } from './summary';

const JUNIT = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="9" failures="1" errors="0" time="1.5">
    <testsuite name="src/core/scoring/scoring.test.ts" timestamp="2026-11-14T19:17:12.150Z" hostname="runner" tests="6" failures="0" errors="0" skipped="1" time="1.25">
        <testcase classname="src/core/scoring/scoring.test.ts" name="a &gt; b" time="0.5">
        </testcase>
    </testsuite>
    <testsuite name="scripts/market/market.test.ts" timestamp="2026-11-14T19:17:13.150Z" hostname="runner" tests="3" failures="1" errors="0" skipped="0" time="0.25">
    </testsuite>
</testsuites>`;

describe('junitSuites', () => {
  it('reads one entry per test file, not the totals line', () => {
    expect(junitSuites(JUNIT)).toEqual([
      { name: 'src/core/scoring/scoring.test.ts', tests: 6, failures: 0, skipped: 1, seconds: 1.25 },
      { name: 'scripts/market/market.test.ts', tests: 3, failures: 1, skipped: 0, seconds: 0.25 },
    ]);
  });
});

describe('builtFiles', () => {
  it('lists scripts and stylesheets, largest first, with their gzip size', () => {
    const dist = mkdtempSync(path.join(tmpdir(), 'astrovivu-dist-'));
    try {
      mkdirSync(path.join(dist, 'assets'));
      writeFileSync(path.join(dist, 'index.html'), '<html></html>');
      writeFileSync(path.join(dist, 'assets', 'index-a.css'), 'body{margin:0}');
      writeFileSync(path.join(dist, 'assets', 'index-b.js'), 'const x = 1;\n'.repeat(400));
      const files = builtFiles(dist);
      expect(files.map((f) => f.file)).toEqual(['assets/index-b.js', 'assets/index-a.css']);
      expect(files[0].bytes).toBe(5200);
      expect(files[0].gzipBytes).toBeLessThan(200);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });
});

describe('summary', () => {
  it('reports totals, failed files and sizes', () => {
    const text = summary(JUNIT, [{ file: 'assets/index-b.js', bytes: 2048, gzipBytes: 1024 }]);
    expect(text).toContain('9 tests in 2 files: 1 failed, 1 skipped, 1.5 s of test time.');
    expect(text).toContain('- `scripts/market/market.test.ts` (1 of 3)');
    expect(text).toContain('| `assets/index-b.js` | 2 kB | 1 kB |');
  });

  it('says what is missing instead of failing', () => {
    const text = summary(null, null);
    expect(text).toContain('the test step did not write a report');
    expect(text).toContain('there is no `dist/` folder');
  });
});
