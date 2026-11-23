// main.ts — entry copier + validator for make.fun competition news-image-20261122.
// Node STDLIB ONLY (node:fs, node:path, node:crypto, node:url).
// Reads entry.png from this repo, validates the PNG, copies it byte-identical to
// $MAKEFUN_OUTPUT_DIR/entry.png (default /output), then re-verifies sha256.
// NEVER writes to the cwd or to this repo: if the output path falls inside the
// repo directory the run refuses with exit 1.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repoDir: string = dirname(fileURLToPath(import.meta.url));
const entryPath: string = join(repoDir, 'entry.png');
const outDir: string = process.env.MAKEFUN_OUTPUT_DIR || '/output';
const outPath: string = resolve(join(outDir, 'entry.png'));

// Guard: output must never land inside this repo (and never equals the source).
const relToRepo: string = relative(repoDir, outPath);
if (relToRepo === '' || !relToRepo.startsWith('..' + sep)) {
  console.error('REFUSED: output path is inside the repo: ' + outPath);
  process.exit(1);
}
// Guard: output must never land in the working directory either.
const relToCwd: string = relative(resolve(process.cwd()), outPath);
if (relToCwd === '' || !relToCwd.startsWith('..' + sep)) {
  console.error('REFUSED: output path is inside the working directory: ' + outPath);
  process.exit(1);
}

const CRC_TABLE: Int32Array = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

interface PngInfo {
  width: number;
  height: number;
}

function validatePNG(buf: Buffer): PngInfo {
  if (buf.length > 1024 * 1024) throw new Error('PNG over 1 MiB: ' + buf.length + ' bytes');
  const MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(MAGIC)) throw new Error('bad PNG magic');
  let off = 8;
  let first = true;
  let sawIDAT = false;
  let sawIEND = false;
  let width = 0;
  let height = 0;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (off + 12 + len > buf.length) throw new Error('truncated chunk ' + type);
    const data = buf.subarray(off + 8, off + 8 + len);
    const storedCrc = buf.readUInt32BE(off + 8 + len);
    if (storedCrc !== crc32(Buffer.concat([Buffer.from(type, 'ascii'), data]))) {
      throw new Error('CRC mismatch in chunk ' + type);
    }
    if (first) {
      if (type !== 'IHDR') throw new Error('first chunk is not IHDR: ' + type);
      if (len !== 13) throw new Error('IHDR length is not 13: ' + len);
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (width > 1024 || height > 1024) throw new Error('sides over 1024: ' + width + 'x' + height);
      // Entry contract is an 8-bit RGB poster.
      if (data[8] !== 8) throw new Error('bit depth is not 8: ' + data[8]);
      if (data[9] !== 2) throw new Error('color type is not RGB (2): ' + data[9]);
      first = false;
    }
    if (type === 'IDAT') sawIDAT = true;
    if (type === 'IEND') {
      sawIEND = true;
      if (off + 12 + len !== buf.length) throw new Error('trailing data after IEND');
      break;
    }
    off += 12 + len;
  }
  if (!sawIDAT) throw new Error('no IDAT chunk');
  if (!sawIEND) throw new Error('no IEND chunk');
  return { width, height };
}

try {
  const input = readFileSync(entryPath);
  const info = validatePNG(input);
  const inputHash = sha256(input);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, input);
  const output = readFileSync(outPath);
  if (output.length !== input.length) throw new Error('output size mismatch after copy');
  const outputHash = sha256(output);
  if (outputHash !== inputHash) throw new Error('output sha256 mismatch after copy');
  console.log(JSON.stringify({
    ok: true,
    source: entryPath,
    output: outPath,
    bytes: input.length,
    width: info.width,
    height: info.height,
    sha256: outputHash,
  }));
} catch (err) {
  if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
    console.error('FAILED: entry.png not found in repo: ' + entryPath);
  } else {
    console.error('FAILED: ' + (err instanceof Error ? err.message : String(err)));
  }
  process.exit(1);
}
