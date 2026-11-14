import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { pageAssets, smoke } from './smoke';

const PAGE = `<!doctype html>
<html>
  <head>
    <script type="module" crossorigin src="/assets/index-abc.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/vendor-def.js">
    <link rel="stylesheet" crossorigin href="/assets/index-ghi.css">
    <link rel="icon" href="/favicon.svg">
    <script src="https://cdn.example.org/tracker.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>`;

const CATALOGUE = JSON.stringify({ count: 2, rows: [['a'], ['b']] });

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

/** A static site in memory: path -> [content type, body]. Unknown paths answer like a single-page host, with the page. */
async function serve(files: Record<string, [type: string, body: string]>): Promise<string> {
  server = createServer((req, res) => {
    const [type, body] = files[req.url ?? '/'] ?? files['/'];
    res.writeHead(200, { 'content-type': type }).end(body);
  });
  await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const site = (over: Record<string, [string, string]> = {}): Record<string, [string, string]> => ({
  '/': ['text/html; charset=utf-8', PAGE],
  '/assets/index-abc.js': ['text/javascript', 'console.log(1)'],
  '/assets/vendor-def.js': ['text/javascript', 'export {}'],
  '/assets/index-ghi.css': ['text/css', 'body{}'],
  '/data/crops/ecocrop.json': ['application/json', CATALOGUE],
  ...over,
});

describe('pageAssets', () => {
  it('finds the scripts and stylesheets of the same origin, nothing else', () => {
    expect(pageAssets(PAGE, 'https://example.org/')).toEqual(['https://example.org/assets/index-abc.js', 'https://example.org/assets/vendor-def.js', 'https://example.org/assets/index-ghi.css']);
  });

  it('resolves relative references against a sub-path', () => {
    expect(pageAssets('<script src="./assets/a.js"></script>', 'https://example.org/app/')).toEqual(['https://example.org/app/assets/a.js']);
  });
});

describe('smoke', () => {
  it('passes a site that serves its page, assets and catalogue', async () => {
    const checks = await smoke(await serve(site()));
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks.map((c) => c.name)).toEqual(['page', 'page loads a script', '/assets/index-abc.js', '/assets/vendor-def.js', '/assets/index-ghi.css', 'data/crops/ecocrop.json']);
  });

  it('fails when an asset is missing and the host answers with the page instead', async () => {
    const files = site();
    delete files['/assets/index-abc.js'];
    const failed = (await smoke(await serve(files))).filter((c) => !c.ok);
    expect(failed.map((c) => c.name)).toEqual(['/assets/index-abc.js']);
    expect(failed[0].detail).toMatch(/expected javascript/);
  });

  it('fails when the catalogue is cut short', async () => {
    const failed = (await smoke(await serve(site({ '/data/crops/ecocrop.json': ['application/json', JSON.stringify({ count: 5, rows: [['a']] })] })))).filter((c) => !c.ok);
    expect(failed.map((c) => c.name)).toEqual(['data/crops/ecocrop.json']);
  });

  it('stops at a page that is not the app', async () => {
    const checks = await smoke(await serve({ '/': ['text/html', '<html><body>Deployment not found</body></html>'] }));
    expect(checks).toHaveLength(1);
    expect(checks[0].ok).toBe(false);
  });
});
