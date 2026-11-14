/**
 * Source registry and cached downloads for the crop atlas.
 *
 * Network manners (AGENTS.md rule 7): one request at a time (so never more than one per host),
 * a timeout on every request, at most 3 retries with backoff, and every file kept under
 * `.cache/atlas/raw/` with its SHA-256 and access date, so a second run downloads nothing.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface Source {
  id: string;
  title: string;
  publisher: string;
  /** Where the bytes come from. Empty for a file that lives in the repository. */
  url: string;
  /** The page a person should cite or visit (dataset landing page, DOI). */
  landing: string;
  /** The licence as read on the publisher's own terms page (see docs/CROP_DATA.md). */
  licence: string;
  /** Cache file name, or a repository-relative path when `url` is empty. */
  file: string;
  timeoutMs?: number;
  /** Checksum published by the data owner; the build refuses a file that differs. */
  md5?: string;
}

export interface Fetched {
  source: Source;
  path: string;
  sha256: string;
  bytes: number;
  /** ISO date of the download (or of first use for a repository file: not applicable, empty). */
  accessed: string;
}

const UA = 'astrovivu-crop-atlas/1.0 (non-commercial research data build; node fetch)';
const WAYBACK = 'https://web.archive.org/web';

const faodef = (chapter: string, stamp: string, original: string): Source => ({
  id: `faodef-${chapter}`,
  title: `FAO, Definition and classification of commodities (draft), chapter ${Number(chapter)}`,
  publisher: 'Food and Agriculture Organization of the United Nations (FAO); copy held by the Internet Archive Wayback Machine',
  url: `${WAYBACK}/${stamp}id_/${original}`,
  landing: original,
  licence:
    'FAO website content: (c) FAO; may be copied and downloaded for private study, research and teaching and for use in non-commercial products or services, with acknowledgement of FAO as source and copyright holder (https://www.fao.org/contact-us/terms/en/)',
  file: `faodef_${chapter}.htm`,
});

export const SOURCES: Source[] = [
  {
    id: 'ecocrop',
    title: 'FAO EcoCrop database, 2,568 species',
    publisher: 'FAO, Land and Water Division',
    url: '',
    landing: 'data/ecocrop/README.md',
    licence: 'Property of FAO; used with attribution for a non-commercial project (data/ecocrop/README.md)',
    file: 'data/ecocrop/ecocrop_2568_plants.csv',
  },
  {
    id: 'curated',
    title: 'Astrovivu curated crop list (73 crops)',
    publisher: 'Astrovivu project',
    url: '',
    landing: 'data/crops/curated-crops.csv',
    licence: 'Project file (MIT, see LICENSE)',
    file: 'data/crops/curated-crops.csv',
  },
  {
    id: 'faostat-qcl',
    title: 'FAOSTAT, Crops and livestock products (QCL), bulk download, normalized',
    publisher: 'FAO',
    url: 'https://bulks-faostat.fao.org/production/Production_Crops_Livestock_E_All_Data_(Normalized).zip',
    landing: 'https://www.fao.org/faostat/en/#data/QCL',
    licence: 'CC BY 4.0 (FAO Statistical Database Terms of Use, https://www.fao.org/contact-us/terms/db-terms-of-use/en/)',
    file: 'faostat_qcl_normalized.zip',
    timeoutMs: 600_000,
  },
  faodef('01', '20220117120211', 'https://www.fao.org/es/faodef/fdef01e.htm'),
  faodef('02', '20220119064549', 'https://www.fao.org/es/faodef/fdef02e.htm'),
  faodef('03', '20210621145201', 'http://www.fao.org/es/faodef/fdef03e.HTM'),
  faodef('04', '20220127070421', 'https://www.fao.org/es/faodef/fdef04e.htm'),
  faodef('05', '20220119134141', 'https://www.fao.org/es/faodef/fdef05e.htm'),
  faodef('06', '20211220125800', 'https://www.fao.org/es/faodef/fdef06e.htm'),
  faodef('07', '20211209114234', 'https://www.fao.org/es/faodef/fdef07e.htm'),
  faodef('08', '20220105081537', 'https://www.fao.org/es/faodef/fdef08e.htm'),
  faodef('09', '20210115020353', 'http://www.fao.org/es/faodef/fdef09e.htm'),
  faodef('10', '20210115152822', 'http://www.fao.org/es/faodef/fdef10e.htm'),
  faodef('11', '20220123230011', 'https://www.fao.org/ES/faodef/fdef11e.htm'),
  faodef('12', '20210114210136', 'http://www.fao.org/es/faodef/fdef12e.htm'),
  faodef('13', '20210114193531', 'http://www.fao.org/es/faodef/fdef13e.htm'),
  {
    id: 'cpc21',
    title: 'Central Product Classification (CPC) Ver. 2.1, structure and explanatory notes (FAO Caliper CSV)',
    publisher: 'United Nations Statistics Division; file served by FAO Caliper',
    url: 'https://stats.fao.org/caliper/download/CPCv2.1/CPC21-core.csv',
    landing: 'https://www.fao.org/statistics/caliper/tools/download/en',
    licence:
      'No licence is stated on the Caliper download page; FAO website terms apply (non-commercial use with acknowledgement); the classification is a United Nations publication',
    file: 'caliper_CPC21-core.csv',
  },
  {
    id: 'm49',
    title: 'UN M49 Standard country or area codes for statistical use (overview table with ISO alpha-3)',
    publisher: 'United Nations Statistics Division',
    url: 'https://unstats.un.org/unsd/methodology/m49/overview/',
    landing: 'https://unstats.un.org/unsd/methodology/m49/overview/',
    licence: '(c) United Nations (page footer); no data licence is stated on the page, the UN website Terms of Use apply (https://www.un.org/en/about-us/terms-of-use, which answered HTTP 403 to this build and was not read)',
    file: 'unsd_m49_overview.html',
  },
  {
    id: 'geonames',
    title: 'GeoNames countryInfo.txt (ISO 3166, ISO numeric and FIPS 10-4 country codes)',
    publisher: 'GeoNames',
    url: 'https://download.geonames.org/export/dump/countryInfo.txt',
    landing: 'https://download.geonames.org/export/dump/',
    licence: 'CC BY 4.0 (https://download.geonames.org/export/dump/readme.txt)',
    file: 'geonames_countryInfo.txt',
  },
  {
    id: 'mapspamc-crosswalk',
    title: 'mapspamc R package, inst/mappings/faostat2crop.csv (FAOSTAT item code to SPAM crop)',
    publisher: 'M. van Dijk et al. (Wageningen Economic Research / IFPRI), GitHub michielvandijk/mapspamc',
    url: 'https://raw.githubusercontent.com/michielvandijk/mapspamc/e729598a7291bf681aca3623a95ade187cc70b01/inst/mappings/faostat2crop.csv',
    landing: 'https://github.com/michielvandijk/mapspamc',
    licence: 'MIT (LICENSE file of the repository)',
    file: 'mapspamc_faostat2crop.csv',
  },
  {
    id: 'spam-readme',
    title: 'SPAM 2020 V2r2 readme (crop list, file layout, citation)',
    publisher: 'International Food Policy Research Institute (IFPRI)',
    url: 'https://www.dropbox.com/scl/fi/n5qyf8uk2ylwg8zmvbmng/Readme_SPAM2020V2r2.txt?rlkey=riphyjg4k2drkvt8ak9l8g4jk&st=2ln7l1gd&dl=1',
    landing: 'https://doi.org/10.7910/DVN/SWPENT',
    licence: 'CC BY 4.0 with citation and the IFPRI adaptation notice (IFPRI Dataverse Terms of Use, December 2019)',
    file: 'Readme_SPAM2020V2r2.txt',
  },
  {
    id: 'spam-harvested-area',
    title: 'SPAM 2020 V2r2, global harvested area, CSV (spam2020V2r2_global_harvested_area.csv.zip)',
    publisher: 'International Food Policy Research Institute (IFPRI)',
    url: 'https://www.dropbox.com/scl/fi/py1g3yovxt8ws7hcfq3ys/spam2020V2r2_global_harvested_area.csv.zip?rlkey=6oay3zyojlhcz1416qsf10o31&st=2dkfuh8d&dl=1',
    landing: 'https://doi.org/10.7910/DVN/SWPENT',
    licence: 'CC BY 4.0 with citation and the IFPRI adaptation notice (IFPRI Dataverse Terms of Use, December 2019)',
    file: 'spam2020V2r2_global_harvested_area.csv.zip',
    timeoutMs: 900_000,
    // MD5 that the Harvard Dataverse record lists for this file (datafile 13740106, dataset version 6.0),
    // read on 2026-11-15 from https://dataverse.harvard.edu/api/datasets/:persistentId/?persistentId=doi:10.7910/DVN/SWPENT
    md5: '9e82eb7c6202cdcf10daf3508356c2dd',
  },
];

interface ManifestEntry {
  url: string;
  accessed: string;
  sha256: string;
  bytes: number;
}

export async function sha256File(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

export async function md5File(file: string): Promise<string> {
  const hash = crypto.createHash('md5');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function download(src: Source, target: string, log: (s: string) => void): Promise<void> {
  const retries = 3;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const wait = 2000 * 3 ** (attempt - 1);
      log(`  retry ${attempt}/${retries} in ${wait / 1000} s (${String(lastError)})`);
      await sleep(wait);
    }
    try {
      const res = await fetch(src.url, {
        redirect: 'follow',
        headers: { 'user-agent': UA, accept: '*/*' },
        signal: AbortSignal.timeout(src.timeoutMs ?? 90_000),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const part = `${target}.part`;
      // The web stream and Node's stream types describe the same object; the cast bridges the two typings.
      await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), fs.createWriteStream(part));
      fs.renameSync(part, target);
      return;
    } catch (e) {
      lastError = e;
      // A client error will not improve with a retry.
      if (e instanceof Error && /^HTTP 4\d\d$/.test(e.message) && e.message !== 'HTTP 429') break;
    }
  }
  throw new Error(`${src.id}: download failed (${String(lastError)}) from ${src.url}`);
}

export interface FetchOptions {
  root: string;
  cacheDir: string;
  offline: boolean;
  log: (s: string) => void;
}

export async function ensureSources(sources: readonly Source[], opts: FetchOptions): Promise<Map<string, Fetched>> {
  fs.mkdirSync(opts.cacheDir, { recursive: true });
  const manifestFile = path.join(opts.cacheDir, 'manifest.json');
  const manifest: Record<string, ManifestEntry> = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
  const out = new Map<string, Fetched>();
  let lastHost = '';
  for (const src of sources) {
    if (!src.url) {
      const p = path.join(opts.root, src.file);
      out.set(src.id, { source: src, path: p, sha256: await sha256File(p), bytes: fs.statSync(p).size, accessed: '' });
      continue;
    }
    const p = path.join(opts.cacheDir, src.file);
    let entry = manifest[src.id];
    const cached = fs.existsSync(p) && entry && entry.url === src.url && fs.statSync(p).size === entry.bytes;
    if (!cached) {
      if (opts.offline) throw new Error(`--offline: ${src.id} is not in the cache (${p}); run once without --offline`);
      const host = new URL(src.url).host;
      // A pause between two requests to the same host keeps the build polite to small servers.
      if (host === lastHost) await sleep(1500);
      lastHost = host;
      opts.log(`download ${src.id} <- ${host}`);
      await download(src, p, opts.log);
      // Local calendar date of the download (toISOString would give the UTC date, a day early at 2 a.m. in UTC+7).
      const now = new Date();
      const accessed = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      entry = { url: src.url, accessed, sha256: await sha256File(p), bytes: fs.statSync(p).size };
      manifest[src.id] = entry;
      fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
    }
    out.set(src.id, { source: src, path: p, sha256: entry.sha256, bytes: entry.bytes, accessed: entry.accessed });
  }
  return out;
}
