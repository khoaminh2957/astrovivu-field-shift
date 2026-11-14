/**
 * Just enough of the ZIP format to read FAOSTAT bulk files without a dependency: stored and
 * deflated entries, no ZIP64, no encryption. The entry is inflated as a stream, so a 200 MB CSV
 * never sits in memory as one string.
 */
import { Readable } from 'node:stream';
import { createInflateRaw } from 'node:zlib';

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  /** Offset of the entry's local header. */
  offset: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export function zipEntries(zip: Buffer): ZipEntry[] {
  // The end-of-central-directory record sits at the end, after an optional comment of up to 64 KiB.
  let at = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--)
    if (zip.readUInt32LE(i) === EOCD) {
      at = i;
      break;
    }
  if (at < 0) throw new Error('Not a ZIP file: no end-of-central-directory record');
  const count = zip.readUInt16LE(at + 10);
  let p = zip.readUInt32LE(at + 16);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== CENTRAL) throw new Error('Corrupt ZIP: bad central directory entry');
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const compressedSize = zip.readUInt32LE(p + 20);
    const size = zip.readUInt32LE(p + 24);
    if (compressedSize === 0xffffffff || size === 0xffffffff) throw new Error('ZIP64 archives are not supported');
    out.push({ name: zip.toString('utf8', p + 46, p + 46 + nameLen), method: zip.readUInt16LE(p + 10), compressedSize, size, offset: zip.readUInt32LE(p + 42) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** The uncompressed bytes of one entry, as a stream. */
export function openZipEntry(zip: Buffer, entry: ZipEntry): Readable {
  if (zip.readUInt32LE(entry.offset) !== LOCAL) throw new Error(`Corrupt ZIP: bad local header for ${entry.name}`);
  // Name and extra-field lengths of the local header may differ from the central directory's.
  const start = entry.offset + 30 + zip.readUInt16LE(entry.offset + 26) + zip.readUInt16LE(entry.offset + 28);
  const data = Readable.from([zip.subarray(start, start + entry.compressedSize)]);
  if (entry.method === 0) return data;
  if (entry.method === 8) return data.pipe(createInflateRaw());
  throw new Error(`Unsupported ZIP compression method ${entry.method} for ${entry.name}`);
}
