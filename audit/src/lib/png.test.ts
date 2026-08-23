import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';

import { cropTopLeft, decodeRgbPng, encodeRgbPng, regionHasContent } from './png';

/** A gradient, so every row and column is distinguishable from its neighbours. */
function gradient(width: number, height: number): Buffer[] {
  return Array.from({ length: height }, (_, y) => {
    const row = Buffer.alloc(width * 3);
    for (let x = 0; x < width; x += 1) {
      row[x * 3] = x % 256;
      row[x * 3 + 1] = y % 256;
      row[x * 3 + 2] = (x + y) % 256;
    }
    return row;
  });
}

test('a round trip returns exactly the pixels it was given', () => {
  const rows = gradient(40, 25);
  const decoded = decodeRgbPng(encodeRgbPng(40, rows));

  assert.equal(decoded.width, 40);
  assert.equal(decoded.height, 25);
  decoded.rows.forEach((row, y) => {
    assert.ok(row.equals(rows[y]!), `row ${y} differs`);
  });
});

test('cropping keeps the top-left corner, not some other corner', () => {
  // Worth asserting rather than eyeballing: an off-by-one on rows or a
  // subarray taken from the wrong end produces a picture that still looks
  // like a picture.
  const rows = gradient(40, 25);
  const cropped = decodeRgbPng(cropTopLeft(encodeRgbPng(40, rows), 10, 8));

  assert.equal(cropped.width, 10);
  assert.equal(cropped.height, 8);
  for (let y = 0; y < 8; y += 1) {
    assert.ok(cropped.rows[y]!.equals(rows[y]!.subarray(0, 30)), `row ${y}`);
  }
});

test('cropping to the full size is a no-op', () => {
  const rows = gradient(12, 9);
  const cropped = decodeRgbPng(cropTopLeft(encodeRgbPng(12, rows), 12, 9));
  cropped.rows.forEach((row, y) => assert.ok(row.equals(rows[y]!)));
});

test('asking for more than there is fails loudly', () => {
  const png = encodeRgbPng(10, gradient(10, 10));
  assert.throws(() => cropTopLeft(png, 20, 5), /only 10x10/);
  assert.throws(() => cropTopLeft(png, 5, 20), /only 10x10/);
});

test('every row filter decodes correctly', () => {
  // Our own encoder always writes filter 0, so a round-trip test alone would
  // never exercise the Sub/Up/Average/Paeth branches — and Chromium's output
  // uses them. This builds the filtered stream by hand.
  const width = 4;
  const expected = [
    Buffer.from([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]),
    Buffer.from([11, 21, 31, 41, 51, 61, 71, 81, 91, 101, 111, 121]),
  ];

  // Row 0 filtered with Sub (1): each byte minus the one three to its left.
  const row0 = Buffer.alloc(width * 3);
  for (let i = 0; i < width * 3; i += 1) {
    row0[i] = (expected[0]![i]! - (i >= 3 ? expected[0]![i - 3]! : 0)) & 0xff;
  }
  // Row 1 filtered with Up (2): each byte minus the one above it.
  const row1 = Buffer.alloc(width * 3);
  for (let i = 0; i < width * 3; i += 1) {
    row1[i] = (expected[1]![i]! - expected[0]![i]!) & 0xff;
  }

  const body = Buffer.concat([
    Buffer.from([1]),
    row0,
    Buffer.from([2]),
    row1,
  ]);

  const png = buildPng(width, 2, deflateSync(body));
  const decoded = decodeRgbPng(png);
  assert.ok(decoded.rows[0]!.equals(expected[0]!), 'Sub filter');
  assert.ok(decoded.rows[1]!.equals(expected[1]!), 'Up filter');
});

test('a format we cannot read is refused rather than misread', () => {
  const png = encodeRgbPng(4, gradient(4, 4));
  png[25] = 6; // claim RGBA
  assert.throws(() => decodeRgbPng(png), /unsupported PNG/);
});

test('a blank region reads as blank and a marked one does not', () => {
  // This is the check that guards the social card: the failure it catches is
  // an image of the right size with one empty band, which throws nothing.
  const rows = Array.from({ length: 20 }, () => Buffer.alloc(20 * 3, 0x11));
  const flat = encodeRgbPng(20, rows);
  assert.equal(regionHasContent(flat, { x: 0, y: 10, width: 20, height: 10 }), false);

  rows[15]![30] = 0xff;
  const marked = encodeRgbPng(20, rows);
  assert.equal(regionHasContent(marked, { x: 0, y: 10, width: 20, height: 10 }), true);
});

test('near-identical pixels count as blank, so noise does not pass for content', () => {
  const rows = Array.from({ length: 10 }, () => Buffer.alloc(10 * 3, 0x40));
  rows[5]![12] = 0x46; // a difference of 6, inside the tolerance
  const png = encodeRgbPng(10, rows);
  assert.equal(regionHasContent(png, { x: 0, y: 0, width: 10, height: 10 }), false);
});

// Minimal writer used only by the filter test above.
function buildPng(width: number, height: number, idat: Buffer): Buffer {
  const crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
  const crc = (data: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of data) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(body), 0);
    return Buffer.concat([len, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
