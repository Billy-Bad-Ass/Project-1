import { deflateSync, inflateSync } from 'node:zlib';

/**
 * Cropping the top-left rectangle out of a PNG.
 *
 * Needed because of one stubborn headless-Chromium behaviour: `--screenshot`
 * writes an image the full height of `--window-size`, but only *paints* the
 * layout viewport, which is meaningfully shorter. Ask for exactly 1200x630 and
 * the bottom of the design — in our case the price and the domain — comes back
 * as blank background, silently and without any error.
 *
 * So the card is rendered in a window with plenty of headroom, where it paints
 * in full, and cut down to size here. That removes the guesswork entirely
 * rather than tuning a magic offset that would drift with the browser version.
 *
 * Only the one format Chromium writes is supported — 8-bit RGB, no interlace —
 * and anything else throws rather than producing a subtly wrong image.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

interface Decoded {
  width: number;
  height: number;
  /** Unfiltered RGB rows, `width * 3` bytes each. */
  rows: Buffer[];
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodeRgbPng(file: Buffer): Decoded {
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');

  const width = file.readUInt32BE(16);
  const height = file.readUInt32BE(20);
  const bitDepth = file[24];
  const colourType = file[25];
  const interlace = file[28];

  // Refusing is the right move: silently mis-reading a 16-bit or palette image
  // produces a plausible-looking picture of nothing in particular.
  if (bitDepth !== 8 || colourType !== 2 || interlace !== 0) {
    throw new Error(
      `unsupported PNG (bitDepth ${String(bitDepth)}, colourType ${String(colourType)}, interlace ${String(interlace)}); expected 8-bit RGB, non-interlaced`,
    );
  }

  const parts: Buffer[] = [];
  let offset = 8;
  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') parts.push(file.subarray(offset + 8, offset + 8 + length));
    if (type === 'IEND') break;
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * 3;
  const rows: Buffer[] = [];
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const start = y * (stride + 1);
    const filter = raw[start];
    const line = Buffer.from(raw.subarray(start + 1, start + 1 + stride));

    // The filters are why reading the inflated bytes directly gives nonsense:
    // every row but a type-0 one is stored as differences from its neighbours.
    for (let i = 0; i < stride; i += 1) {
      const left = i >= 3 ? line[i - 3]! : 0;
      const up = previous[i]!;
      const upLeft = i >= 3 ? previous[i - 3]! : 0;
      switch (filter) {
        case 0:
          break;
        case 1:
          line[i] = (line[i]! + left) & 0xff;
          break;
        case 2:
          line[i] = (line[i]! + up) & 0xff;
          break;
        case 3:
          line[i] = (line[i]! + ((left + up) >> 1)) & 0xff;
          break;
        case 4:
          line[i] = (line[i]! + paeth(left, up, upLeft)) & 0xff;
          break;
        default:
          throw new Error(`unknown PNG row filter ${String(filter)} on row ${y}`);
      }
    }

    rows.push(line);
    previous = line;
  }

  return { width, height, rows };
}

export function encodeRgbPng(width: number, rows: Buffer[]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(rows.length, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  // 10, 11, 12 stay zero: deflate, adaptive filtering, no interlace.

  const stride = width * 3;
  const body = Buffer.alloc(rows.length * (stride + 1));
  rows.forEach((row, y) => {
    body[y * (stride + 1)] = 0; // filter: none
    row.copy(body, y * (stride + 1) + 1, 0, stride);
  });

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(body, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The top-left `width` x `height` rectangle. */
export function cropTopLeft(file: Buffer, width: number, height: number): Buffer {
  const image = decodeRgbPng(file);
  if (width > image.width || height > image.height) {
    throw new Error(
      `cannot crop to ${width}x${height}: the image is only ${image.width}x${image.height}`,
    );
  }
  const rows = image.rows.slice(0, height).map((row) => row.subarray(0, width * 3));
  return encodeRgbPng(width, rows);
}

/**
 * Whether a region contains anything other than the flat background.
 *
 * The failure this exists to catch does not look like a failure: the image is
 * the right size, most of it is correct, and one band of it is empty. Nothing
 * throws. So the build asserts that the part of the card carrying the price
 * actually has pixels in it.
 */
export function regionHasContent(
  file: Buffer,
  box: { x: number; y: number; width: number; height: number },
  tolerance = 12,
): boolean {
  const image = decodeRgbPng(file);
  const first = image.rows[box.y]?.subarray(box.x * 3, box.x * 3 + 3);
  if (!first) return false;

  for (let y = box.y; y < Math.min(box.y + box.height, image.height); y += 1) {
    const row = image.rows[y];
    if (!row) continue;
    for (let x = box.x; x < Math.min(box.x + box.width, image.width); x += 1) {
      const i = x * 3;
      if (
        Math.abs(row[i]! - first[0]!) > tolerance ||
        Math.abs(row[i + 1]! - first[1]!) > tolerance ||
        Math.abs(row[i + 2]! - first[2]!) > tolerance
      ) {
        return true;
      }
    }
  }
  return false;
}
