import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const outputSize = 256
const scale = 4
const size = outputSize * scale
const pixels = new Uint8Array(size * size * 4)

function blendPixel(x, y, color) {
  if (x < 0 || y < 0 || x >= size || y >= size) return
  const index = (y * size + x) * 4
  const alpha = color[3] / 255
  const inverse = 1 - alpha
  pixels[index] = Math.round(color[0] * alpha + pixels[index] * inverse)
  pixels[index + 1] = Math.round(color[1] * alpha + pixels[index + 1] * inverse)
  pixels[index + 2] = Math.round(color[2] * alpha + pixels[index + 2] * inverse)
  pixels[index + 3] = Math.round((alpha + (pixels[index + 3] / 255) * inverse) * 255)
}

function roundedRect(x, y, width, height, radius, color) {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      const nearestX = Math.max(x + radius, Math.min(px, x + width - radius - 1))
      const nearestY = Math.max(y + radius, Math.min(py, y + height - radius - 1))
      const dx = px - nearestX
      const dy = py - nearestY
      if (dx * dx + dy * dy <= radius * radius) blendPixel(px, py, color)
    }
  }
}

function triangle(ax, ay, bx, by, cx, cy, color) {
  const minX = Math.floor(Math.min(ax, bx, cx))
  const maxX = Math.ceil(Math.max(ax, bx, cx))
  const minY = Math.floor(Math.min(ay, by, cy))
  const maxY = Math.ceil(Math.max(ay, by, cy))
  const sign = (px, py, x1, y1, x2, y2) => (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2)
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const d1 = sign(x, y, ax, ay, bx, by)
      const d2 = sign(x, y, bx, by, cx, cy)
      const d3 = sign(x, y, cx, cy, ax, ay)
      if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) blendPixel(x, y, color)
    }
  }
}

roundedRect(28 * scale, 28 * scale, 200 * scale, 200 * scale, 54 * scale, [17, 19, 16, 255])
roundedRect(53 * scale, 53 * scale, 150 * scale, 150 * scale, 43 * scale, [184, 233, 134, 255])
triangle(111 * scale, 91 * scale, 111 * scale, 165 * scale, 169 * scale, 128 * scale, [23, 32, 14, 255])

const downsampled = new Uint8Array(outputSize * outputSize * 4)
for (let y = 0; y < outputSize; y += 1) {
  for (let x = 0; x < outputSize; x += 1) {
    const sum = [0, 0, 0, 0]
    for (let sy = 0; sy < scale; sy += 1) {
      for (let sx = 0; sx < scale; sx += 1) {
        const source = (((y * scale + sy) * size) + x * scale + sx) * 4
        for (let channel = 0; channel < 4; channel += 1) sum[channel] += pixels[source + channel]
      }
    }
    const target = (y * outputSize + x) * 4
    for (let channel = 0; channel < 4; channel += 1) downsampled[target + channel] = Math.round(sum[channel] / (scale * scale))
  }
}

const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n += 1) {
  let c = n
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c >>> 0
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type)
  const output = Buffer.alloc(12 + data.length)
  output.writeUInt32BE(data.length, 0)
  typeBuffer.copy(output, 4)
  Buffer.from(data).copy(output, 8)
  output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, Buffer.from(data)])), 8 + data.length)
  return output
}

const raw = Buffer.alloc((outputSize * 4 + 1) * outputSize)
for (let y = 0; y < outputSize; y += 1) {
  const row = y * (outputSize * 4 + 1)
  raw[row] = 0
  Buffer.from(downsampled.buffer, y * outputSize * 4, outputSize * 4).copy(raw, row + 1)
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(outputSize, 0)
ihdr.writeUInt32BE(outputSize, 4)
ihdr[8] = 8
ihdr[9] = 6
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

const icoHeader = Buffer.alloc(22)
icoHeader.writeUInt16LE(0, 0)
icoHeader.writeUInt16LE(1, 2)
icoHeader.writeUInt16LE(1, 4)
icoHeader[6] = 0
icoHeader[7] = 0
icoHeader.writeUInt16LE(1, 10)
icoHeader.writeUInt16LE(32, 12)
icoHeader.writeUInt32LE(png.length, 14)
icoHeader.writeUInt32LE(22, 18)

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const buildDirectory = resolve(scriptDirectory, '../build')
mkdirSync(buildDirectory, { recursive: true })
writeFileSync(resolve(buildDirectory, 'icon.png'), png)
writeFileSync(resolve(buildDirectory, 'icon.ico'), Buffer.concat([icoHeader, png]))
console.log('Generated build/icon.png and build/icon.ico')
