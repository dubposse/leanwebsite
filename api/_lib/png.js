import { inflateSync } from 'node:zlib'

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
  return value >>> 0
})

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255]
  return (crc ^ 0xffffffff) >>> 0
}

export function isValidPng(bytes, maxPixels) {
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(SIGNATURE)) return false
  let offset = 8
  let header
  let palette = false
  let idatEnded = false
  let ended = false
  const imageChunks = []
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > bytes.length) return false
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const data = bytes.subarray(offset + 8, end - 4)
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) return false
    if (!header && type !== 'IHDR') return false
    if (imageChunks.length && type !== 'IDAT') idatEnded = true
    if (type === 'IHDR') {
      if (header || length !== 13) return false
      const width = data.readUInt32BE(0)
      const height = data.readUInt32BE(4)
      const depth = data[8]
      const color = data[9]
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }
      if (!width || !height || width * height > maxPixels || !depths[color]?.includes(depth)
        || data[10] !== 0 || data[11] !== 0 || data[12] > 1) return false
      header = { width, height, depth, color, interlace: data[12] }
    } else if (type === 'PLTE') {
      if (palette || imageChunks.length || length === 0 || length > 768 || length % 3
        || header.color === 0 || header.color === 4 || (header.color === 3 && length / 3 > 2 ** header.depth)) return false
      palette = true
    } else if (type === 'IDAT') {
      if (idatEnded || (header.color === 3 && !palette)) return false
      imageChunks.push(data)
    } else if (type === 'IEND') {
      if (length || !imageChunks.length || end !== bytes.length) return false
      ended = true
      break
    } else if (type === 'acTL' || type === 'fcTL' || type === 'fdAT' || type[0] === type[0].toUpperCase()) {
      return false
    }
    offset = end
  }
  if (!ended) return false

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.color]
  const passes = header.interlace
    ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]
    : [[0, 0, 1, 1]]
  const rows = passes.map(([x, y, dx, dy]) => {
    const width = Math.max(0, Math.ceil((header.width - x) / dx))
    const height = Math.max(0, Math.ceil((header.height - y) / dy))
    return { height: width ? height : 0, bytes: 1 + Math.ceil(width * channels * header.depth / 8) }
  })
  const expected = rows.reduce((total, row) => total + row.height * row.bytes, 0)
  if (expected > 48 * 1024 * 1024) return false
  let raw
  try {
    const compressed = Buffer.concat(imageChunks)
    const result = inflateSync(compressed, { maxOutputLength: expected + 1, info: true })
    if (result.engine.bytesWritten !== compressed.length) return false
    raw = result.buffer
  } catch {
    return false
  }
  if (raw.length !== expected) return false
  let position = 0
  for (const row of rows) {
    for (let y = 0; y < row.height; y++) {
      if (raw[position] > 4) return false
      position += row.bytes
    }
  }
  return true
}
