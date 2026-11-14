/**
 * Which curated crops have a photograph on FAO EcoCrop, and how large it is.
 * Writes `public/data/crops/images.json`; the Urban Grower reads it and only draws an <img> for
 * crops listed there. The photographs themselves stay on FAO's server (see docs/DATA_SOURCES.md):
 * this script reads each one once to learn that it exists and its pixel size, and keeps only that.
 *
 *   npx tsx scripts/crops/crop-images.ts [--refresh]
 *
 * Outcomes are cached in `.cache/crop-images/<code>.json`, so a second run makes no request.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { listCrops } from '../../src/core/crops';
import { ECOCROP_CREDIT, ECOCROP_HOST, ECOCROP_TERMS_URL, ecocropPhotoUrl, type CropImageManifest, type CropImageSize } from '../../src/core/urban/ecocrop';

const CACHE_DIR = '.cache/crop-images';
const OUT = 'public/data/crops/images.json';
const TIMEOUT_MS = 15_000;
const RETRIES = 3;
const CONCURRENCY = 4;
const refresh = process.argv.includes('--refresh');

/** A settled answer from FAO: the photograph exists (with its size when readable) or it does not. */
interface Outcome {
  code: number;
  found: boolean;
  status: number;
  size?: CropImageSize;
  bytes?: number;
  checkedAt: string;
}

/**
 * Width and height from a JPEG's frame header (the SOFn segment), without decoding the picture.
 * Returns null for anything that is not a JPEG or has no frame header.
 */
export function jpegSize(buf: Uint8Array): CropImageSize | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i++; // fill byte before a marker
      continue;
    }
    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    const len = (buf[i + 2] << 8) | buf[i + 3];
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const h = (buf[i + 5] << 8) | buf[i + 6];
      const w = (buf[i + 7] << 8) | buf[i + 8];
      return w > 0 && h > 0 ? { w, h } : null;
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readCache(code: number): Promise<Outcome | null> {
  if (refresh) return null;
  try {
    return JSON.parse(await readFile(`${CACHE_DIR}/${code}.json`, 'utf8')) as Outcome;
  } catch {
    return null;
  }
}

/** One photograph. Throws only when FAO could not be reached after the retries: that is not an answer. */
async function check(code: number): Promise<{ outcome: Outcome; cached: boolean }> {
  const hit = await readCache(code);
  if (hit) return { outcome: hit, cached: true };
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
    try {
      const res = await fetch(ecocropPhotoUrl(code), { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': 'crop-photo-manifest/1.0 (node)', accept: 'image/jpeg' } });
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }
      const checkedAt = new Date().toISOString();
      let outcome: Outcome = { code, found: false, status: res.status, checkedAt };
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        // A missing photograph can come back as an HTML page with status 200: trust the bytes.
        const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
        if (isJpeg) outcome = { code, found: true, status: res.status, size: jpegSize(bytes) ?? undefined, bytes: bytes.length, checkedAt };
      }
      await writeFile(`${CACHE_DIR}/${code}.json`, JSON.stringify(outcome));
      return { outcome, cached: false };
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`EcoCrop photo ${code}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  // All curated crops: the urban set (32) is a subset, and other screens may want the pictures later.
  const crops = listCrops().filter((c) => c.ecocropId != null);
  const noCode = listCrops().filter((c) => c.ecocropId == null).map((c) => c.id);
  const queue = [...crops];
  const outcomes = new Map<number, Outcome>();
  const failed: string[] = [];
  let requests = 0;

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        try {
          const { outcome, cached } = await check(c.ecocropId!);
          if (!cached) requests++;
          outcomes.set(c.ecocropId!, outcome);
        } catch (err) {
          failed.push(`${c.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }),
  );

  const images: CropImageManifest['images'] = {};
  for (const c of crops) {
    const o = outcomes.get(c.ecocropId!);
    if (o?.found) images[String(c.ecocropId)] = o.size ?? true;
  }
  const manifest: CropImageManifest = { generatedAt: new Date().toISOString(), source: `${ECOCROP_HOST}/ecocrop/ec_images/<code>.jpg`, terms: ECOCROP_TERMS_URL, credit: ECOCROP_CREDIT, images };
  await writeFile(OUT, `${JSON.stringify(manifest, null, 1)}\n`);

  const urban = crops.filter((c) => c.urban?.suitable);
  const has = (c: (typeof crops)[number]) => images[String(c.ecocropId)] != null;
  console.log(`curated crops with an EcoCrop code: ${crops.length} (no code: ${noCode.join(', ') || 'none'})`);
  console.log(`with a photograph: ${crops.filter(has).length} of ${crops.length}; urban crops: ${urban.filter(has).length} of ${urban.length + listCrops().filter((c) => c.urban?.suitable && c.ecocropId == null).length}`);
  console.log(`without: ${crops.filter((c) => outcomes.has(c.ecocropId!) && !has(c)).map((c) => `${c.id} (${c.ecocropId}, HTTP ${outcomes.get(c.ecocropId!)!.status})`).join(', ') || 'none'}`);
  console.log(`requests to FAO this run: ${requests}; from cache: ${outcomes.size - requests}`);
  if (failed.length) {
    console.error(`not answered (left out of the manifest, not cached):\n  ${failed.join('\n  ')}`);
    process.exitCode = 1;
  }
  console.log(`wrote ${OUT}`);
}

// Only when run as a script, so `jpegSize` can be imported by a test without touching the network.
if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/crops/crop-images.ts')) await main();
