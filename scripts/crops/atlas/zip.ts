/**
 * Minimal ZIP reader and writer on Node's zlib, so the build needs no archive package.
 * Reader: stored and deflated entries, streamed (the FAOSTAT table is 545 MB unpacked).
 * Writer: deflated entries with a fixed timestamp, so the same input gives the same bytes.
 * ZIP64 is not supported: every archive used here is far below 4 GB.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import type { Readable } from 'node:stream';

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

export function listZip(file: string): ZipEntry[] {
  const fd = fs.openSync(file, 'r');
  try {
    const total = fs.fstatSync(fd).size;
    const tailLen = Math.min(total, 65557);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, total - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error(`${file}: not a zip archive (no end-of-central-directory record)`);
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (cdOffset === 0xffffffff || count === 0xffff) throw new Error(`${file}: ZIP64 archives are not supported`);
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOffset);
    const entries: ZipEntry[] = [];
    let p = 0;
    for (let k = 0; k < count; k++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error(`${file}: corrupt central directory`);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      entries.push({
        name: cd.toString('utf8', p + 46, p + 46 + nameLen),
        method: cd.readUInt16LE(p + 10),
        compressedSize: cd.readUInt32LE(p + 20),
        size: cd.readUInt32LE(p + 24),
        localOffset: cd.readUInt32LE(p + 42),
      });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } finally {
    fs.closeSync(fd);
  }
}

function dataStart(file: string, entry: ZipEntry): number {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(30);
    fs.readSync(fd, head, 0, 30, entry.localOffset);
    if (head.readUInt32LE(0) !== 0x04034b50) throw new Error(`${file}: corrupt local header for ${entry.name}`);
    return entry.localOffset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  } finally {
    fs.closeSync(fd);
  }
}

/** Decompressed byte stream of one entry. */
export function openZipEntry(file: string, entry: ZipEntry): Readable {
  const start = dataStart(file, entry);
  if (entry.method !== 0 && entry.method !== 8) throw new Error(`${file}: unsupported compression method ${entry.method} for ${entry.name}`);
  const raw = fs.createReadStream(file, { start, end: start + Math.max(entry.compressedSize, 1) - 1 });
  return entry.method === 0 ? raw : raw.pipe(zlib.createInflateRaw());
}

export function readZipEntry(file: string, entry: ZipEntry): Buffer {
  const start = dataStart(file, entry);
  const fd = fs.openSync(file, 'r');
  try {
    const raw = Buffer.alloc(entry.compressedSize);
    fs.readSync(fd, raw, 0, entry.compressedSize, start);
    return entry.method === 0 ? raw : zlib.inflateRawSync(raw);
  } finally {
    fs.closeSync(fd);
  }
}

export interface ZipInput {
  name: string;
  data: Buffer;
}

/** 1980-01-01 00:00: a constant, so archives are reproducible byte for byte. */
const DOS_TIME = 0;
const DOS_DATE = 0x21;

export function buildZip(inputs: readonly ZipInput[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of inputs) {
    const nameBuf = Buffer.from(name, 'utf8');
    const body = zlib.deflateRawSync(data, { level: 6 });
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // flag bit 11: names are UTF-8
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(DOS_TIME, 12);
    cen.writeUInt16LE(DOS_DATE, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    parts.push(local, nameBuf, body);
    central.push(cen, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(inputs.length, 8);
  end.writeUInt16LE(inputs.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
