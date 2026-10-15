import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ICONS_DIR = path.join(__dirname, '..', 'public', 'icons');

if (!fs.existsSync(ICONS_DIR)) {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
}

// CRC32 table for PNG chunk checksums
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(8 + len + 4);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 4, 'ascii');
  data.copy(buf, 8);
  const crc = crc32(buf.subarray(4, 8 + len));
  buf.writeUInt32BE(crc, 8 + len);
  return buf;
}

function generateIconPNG(size, isMaskable = false) {
  // Generate RGBA buffer
  const stride = 1 + size * 4;
  const rawData = Buffer.alloc(stride * size);

  const center = size / 2;
  const radius = size * 0.42;

  // Colors
  const bgRed = 224, bgGreen = 83, bgBlue = 60; // #e0533c (brand terracotta)
  const amberRed = 245, amberGreen = 158, amberBlue = 11; // #f59e0b

  for (let y = 0; y < size; y++) {
    const rowOffset = y * stride;
    rawData[rowOffset] = 0; // Filter byte: None

    for (let x = 0; x < size; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      const dx = x - center;
      const dy = y - center;
      const dist = Math.sqrt(dx * dx + dy * dy);

      const gradT = (x + y) / (size * 2);
      const r = Math.round(amberRed * (1 - gradT) + bgRed * gradT);
      const g = Math.round(amberGreen * (1 - gradT) + bgGreen * gradT);
      const b = Math.round(amberBlue * (1 - gradT) + bgBlue * gradT);

      if (isMaskable || dist <= radius) {
        // Inside icon background
        // Draw book symbol in white/cream
        const bookW = size * 0.45;
        const bookH = size * 0.35;
        const inBookX = Math.abs(dx) <= bookW / 2;
        const inBookY = Math.abs(dy) <= bookH / 2;

        if (inBookX && inBookY && Math.abs(dx) > size * 0.02) {
          // Book pages
          rawData[pxOffset] = 255;
          rawData[pxOffset + 1] = 250;
          rawData[pxOffset + 2] = 242;
          rawData[pxOffset + 3] = 255;
        } else if (Math.abs(dx) <= size * 0.02 && inBookY) {
          // Book spine
          rawData[pxOffset] = 180;
          rawData[pxOffset + 1] = 40;
          rawData[pxOffset + 2] = 20;
          rawData[pxOffset + 3] = 255;
        } else {
          rawData[pxOffset] = r;
          rawData[pxOffset + 1] = g;
          rawData[pxOffset + 2] = b;
          rawData[pxOffset + 3] = 255;
        }
      } else {
        // Transparent outside circle for non-maskable
        rawData[pxOffset] = 0;
        rawData[pxOffset + 1] = 0;
        rawData[pxOffset + 2] = 0;
        rawData[pxOffset + 3] = 0;
      }
    }
  }

  const deflated = zlib.deflateSync(rawData);

  // PNG Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const ihdrChunk = makeChunk('IHDR', ihdr);

  // IDAT chunk
  const idatChunk = makeChunk('IDAT', deflated);

  // IEND chunk
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

fs.writeFileSync(path.join(ICONS_DIR, 'icon-192.png'), generateIconPNG(192, false));
fs.writeFileSync(path.join(ICONS_DIR, 'icon-512.png'), generateIconPNG(512, false));
fs.writeFileSync(path.join(ICONS_DIR, 'icon-maskable.png'), generateIconPNG(512, true));

console.log('Generated PWA PNG icons successfully in public/icons/');
