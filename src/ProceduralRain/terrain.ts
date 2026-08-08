import type { Preset, Quality } from './types'
import { createRandom, hashString, noise1D } from './random'

export interface TerrainGrid {
  cells: Uint8Array
  cols: number
  rows: number
  cell: number
  width: number
  height: number
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value))

export function generateTerrain(
  width: number,
  height: number,
  preset: Preset,
  seed: string,
  quality: Quality,
): TerrainGrid {
  const targetCell = quality === 'high' ? 10 : quality === 'low' ? 16 : width * height > 1_100_000 ? 14 : 12
  const cell = clamp(Math.round(targetCell), 10, 18)
  const cols = Math.ceil(width / cell)
  const rows = Math.ceil(height / cell)
  const cells = new Uint8Array(cols * rows)
  const random = createRandom(`${seed}:${preset}`)
  const numericSeed = hashString(seed) % 10_000

  const set = (x: number, y: number, value = 1) => {
    if (x >= 0 && x < cols && y >= 0 && y < rows) cells[y * cols + x] = value
  }
  const fillRect = (x: number, y: number, w: number, h: number, value = 1) => {
    const x0 = clamp(Math.floor(x), 0, cols)
    const y0 = clamp(Math.floor(y), 0, rows)
    const x1 = clamp(Math.ceil(x + w), 0, cols)
    const y1 = clamp(Math.ceil(y + h), 0, rows)
    for (let row = y0; row < y1; row += 1) {
      cells.fill(value, row * cols + x0, row * cols + x1)
    }
  }

  // Every preset gets an irregular floor so water always has somewhere to settle.
  for (let x = 0; x < cols; x += 1) {
    const broad = noise1D(x * 0.075, numericSeed)
    const detail = noise1D(x * 0.23, numericSeed + 91)
    const floor = Math.floor(rows * (preset === 'shafts' ? 0.88 : 0.78) + (broad - 0.5) * rows * 0.13 + detail * 2)
    for (let y = floor; y < rows; y += 1) set(x, y)
  }

  if (preset === 'ruins') {
    // Broad roofs and broken pillars make the rain-shadow behavior immediately readable.
    const roofY = Math.floor(rows * 0.26)
    fillRect(cols * 0.08, roofY, cols * 0.34, 2)
    fillRect(cols * 0.15, roofY + 2, 2, rows * 0.34)
    fillRect(cols * 0.38, roofY + 2, 2, rows * 0.18)
    fillRect(cols * 0.54, rows * 0.43, cols * 0.3, 2)
    fillRect(cols * 0.78, rows * 0.45, 2, rows * 0.25)
    fillRect(cols * 0.49, rows * 0.6, cols * 0.13, 2)
    for (let index = 0; index < 4; index += 1) {
      const x = Math.floor(random() * cols * 0.8 + cols * 0.1)
      const y = Math.floor(rows * (0.35 + random() * 0.3))
      fillRect(x, y, 3 + random() * cols * 0.1, 1 + Math.round(random()))
    }
  }

  if (preset === 'caves') {
    // A mostly sealed ceiling with three narrow vents creates sheltered, dripping chambers.
    for (let x = 0; x < cols; x += 1) {
      const ceiling = Math.floor(rows * 0.13 + noise1D(x * 0.11, numericSeed + 204) * rows * 0.09)
      for (let y = 0; y < ceiling; y += 1) set(x, y)
    }
    const vents = [0.17, 0.52, 0.83]
    for (const position of vents) {
      const ventX = Math.floor(cols * position + (random() - 0.5) * cols * 0.06)
      fillRect(ventX - 2, 0, 4 + Math.floor(random() * 3), rows * 0.26, 0)
    }
    fillRect(cols * 0.04, rows * 0.38, cols * 0.31, 3)
    fillRect(cols * 0.65, rows * 0.35, cols * 0.31, 3)
    fillRect(cols * 0.27, rows * 0.57, cols * 0.48, 2)
    fillRect(cols * 0.31, rows * 0.59, 3, rows * 0.12)
    fillRect(cols * 0.71, rows * 0.2, 3, rows * 0.17)
  }

  if (preset === 'shafts') {
    fillRect(0, 0, cols * 0.12, rows)
    fillRect(cols * 0.88, 0, cols * 0.12, rows)
    fillRect(cols * 0.32, rows * 0.18, cols * 0.12, rows * 0.7)
    fillRect(cols * 0.65, rows * 0.3, cols * 0.1, rows * 0.58)
    fillRect(cols * 0.1, rows * 0.36, cols * 0.2, 2)
    fillRect(cols * 0.44, rows * 0.52, cols * 0.19, 2)
    fillRect(cols * 0.75, rows * 0.23, cols * 0.14, 2)
    fillRect(cols * 0.14, rows * 0.69, cols * 0.16, 2)
  }

  if (preset === 'wilds') {
    // Build a readable composition from terrain "phrases" rather than scattering
    // rectangles. Each phrase has shelter, a vertical interruption, and an exit
    // for water, so generated scenes stay interesting to both rain and runoff.
    const zoneCount = Math.max(3, Math.min(5, Math.floor(cols / 22)))
    const zoneWidth = cols / zoneCount
    for (let zone = 0; zone < zoneCount; zone += 1) {
      const start = zone * zoneWidth
      const inset = 1 + Math.floor(random() * Math.max(2, zoneWidth * 0.12))
      const x = start + inset
      const width = Math.max(7, zoneWidth - inset - 1 - random() * zoneWidth * 0.14)
      const motif = Math.floor(random() * 4)
      const high = rows * (0.18 + random() * 0.18)
      const middle = rows * (0.42 + random() * 0.16)

      if (motif === 0) {
        // Arch: strong rain shadow with two unequal runoff edges.
        fillRect(x, high, width, 2)
        fillRect(x + 1, high + 2, 2 + random() * 2, rows * (0.2 + random() * 0.2))
        fillRect(x + width - 3, high + 2, 2, rows * (0.1 + random() * 0.26))
      } else if (motif === 1) {
        // Staggered shelves make a small cascade.
        fillRect(x, high, width * 0.68, 2)
        fillRect(x + width * 0.3, middle, width * 0.68, 2)
        fillRect(x + width * (random() < 0.5 ? 0.3 : 0.82), middle + 2, 2, rows * 0.18)
      } else if (motif === 2) {
        // A monolith creates a shaft; cut windows prevent a solid dead zone.
        const wallX = x + width * (0.25 + random() * 0.45)
        fillRect(wallX, high, Math.max(3, width * 0.2), rows * 0.55)
        fillRect(wallX - width * 0.32, middle, width * 0.34, 2)
        fillRect(wallX + width * 0.18, rows * 0.3, width * 0.35, 2)
        fillRect(wallX, rows * 0.52, Math.max(3, width * 0.2), rows * 0.1, 0)
      } else {
        // Hanging canopy with a low catchment beneath it.
        fillRect(x, high, width, 2)
        fillRect(x + width * 0.12, high + 2, Math.max(2, width * 0.13), rows * 0.2)
        fillRect(x + width * 0.18, rows * 0.63, width * 0.62, 2)
        fillRect(x + width * 0.18, rows * 0.65, 2, rows * 0.08)
        fillRect(x + width * 0.76, rows * 0.65, 2, rows * 0.08)
      }
    }

    // Cut a few narrow weather channels from the sky. They keep every generated
    // composition permeable and turn accidental overlaps into cave-like vents.
    const channelCount = 2 + Math.floor(random() * 3)
    for (let channel = 0; channel < channelCount; channel += 1) {
      const channelX = cols * (0.08 + random() * 0.84)
      fillRect(channelX, 0, 2 + random() * 2, rows * (0.42 + random() * 0.28), 0)
    }

    // Small ledges bridge otherwise empty gaps and provide drip points.
    for (let ledge = 0; ledge < 3; ledge += 1) {
      fillRect(
        cols * (0.06 + random() * 0.78),
        rows * (0.3 + random() * 0.38),
        cols * (0.08 + random() * 0.12),
        1 + Math.round(random()),
      )
    }
  }

  // Seal only the bottom boundary; water can blow off either side of the scene.
  fillRect(0, rows - 1, cols, 1)
  return { cells, cols, rows, cell, width, height }
}
