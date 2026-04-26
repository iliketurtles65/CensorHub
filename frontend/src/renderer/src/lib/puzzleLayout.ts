/**
 * Puzzle-piece layout algorithm for the Grid mode.
 * Generates a gap-free tiled layout with variable tile sizes.
 */

export interface TilePosition {
  id: number
  row: number
  col: number
  rowSpan: number
  colSpan: number
  x: number
  y: number
  width: number
  height: number
}

interface LayoutConfig {
  containerWidth: number
  containerHeight: number
  tileCount: number
  density: number // 0-100
  gap: number
}

// Tile span options with weights (probability of selection)
const TILE_CONFIGS: [number, number, number][] = [
  // [rowSpan, colSpan, weight]
  [1, 1, 0.35],
  [1, 2, 0.15],
  [2, 1, 0.15],
  [2, 2, 0.2],
  [1, 3, 0.08],
  [3, 1, 0.07]
]

export function generatePuzzleLayout(config: LayoutConfig): TilePosition[] {
  const { containerWidth, containerHeight, tileCount, density, gap } = config

  // Map density (0-100) to grid dimensions
  const cols = Math.max(2, Math.round(2 + (density / 100) * 6)) // 2-8
  const rows = Math.max(2, Math.round(cols * (containerHeight / containerWidth))) // aspect-ratio-matched

  const cellW = (containerWidth - gap * (cols - 1)) / cols
  const cellH = (containerHeight - gap * (rows - 1)) / rows

  // Track occupied cells
  const occupied: boolean[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => false)
  )

  const tiles: TilePosition[] = []
  let tileId = 0

  // Greedy placement — fill ALL grid cells (tileCount is a max, but fill the space)
  const maxTiles = Math.min(tileCount, rows * cols)
  for (let r = 0; r < rows && tileId < maxTiles; r++) {
    for (let c = 0; c < cols && tileId < maxTiles; c++) {
      if (occupied[r][c]) continue

      // Try tile configs in weighted random order
      const config = pickTileConfig(r, c, rows, cols, occupied)

      // Place tile
      for (let dr = 0; dr < config[0]; dr++) {
        for (let dc = 0; dc < config[1]; dc++) {
          occupied[r + dr][c + dc] = true
        }
      }

      tiles.push({
        id: tileId,
        row: r,
        col: c,
        rowSpan: config[0],
        colSpan: config[1],
        x: c * (cellW + gap),
        y: r * (cellH + gap),
        width: config[1] * cellW + (config[1] - 1) * gap,
        height: config[0] * cellH + (config[0] - 1) * gap
      })

      tileId++
    }
  }

  return tiles
}

function pickTileConfig(
  row: number,
  col: number,
  maxRows: number,
  maxCols: number,
  occupied: boolean[][]
): [number, number] {
  // Shuffle configs by weight
  const shuffled = [...TILE_CONFIGS]
    .map(([rs, cs, w]) => ({ rs, cs, w, sort: Math.random() * w }))
    .sort((a, b) => b.sort - a.sort)

  for (const { rs, cs } of shuffled) {
    if (canPlace(row, col, rs, cs, maxRows, maxCols, occupied)) {
      return [rs, cs]
    }
  }

  return [1, 1] // Fallback
}

function canPlace(
  row: number,
  col: number,
  rowSpan: number,
  colSpan: number,
  maxRows: number,
  maxCols: number,
  occupied: boolean[][]
): boolean {
  if (row + rowSpan > maxRows || col + colSpan > maxCols) return false

  for (let r = row; r < row + rowSpan; r++) {
    for (let c = col; c < col + colSpan; c++) {
      if (occupied[r][c]) return false
    }
  }
  return true
}

/**
 * Generate a simple uniform grid layout.
 */
export function generateUniformLayout(
  containerWidth: number,
  containerHeight: number,
  gridCols: number,
  gridRows: number,
  gap: number = 2
): TilePosition[] {
  const cellW = (containerWidth - gap * (gridCols - 1)) / gridCols
  const cellH = (containerHeight - gap * (gridRows - 1)) / gridRows
  const tiles: TilePosition[] = []

  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      tiles.push({
        id: r * gridCols + c,
        row: r,
        col: c,
        rowSpan: 1,
        colSpan: 1,
        x: c * (cellW + gap),
        y: r * (cellH + gap),
        width: cellW,
        height: cellH
      })
    }
  }

  return tiles
}
