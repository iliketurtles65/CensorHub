import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react'
import {
  generatePuzzleLayout,
  generateUniformLayout,
  type TilePosition
} from '../../lib/puzzleLayout'
import { VideoTile } from './VideoTile'

interface MediaFile {
  path: string
  name: string
  type: 'video' | 'image'
  size: number
}

interface PuzzleGridProps {
  files: MediaFile[]
  layoutMode: 'puzzle' | '2x2' | '3x3' | '4x4'
  density: number
  volume: number
  onVideoRef?: (tileId: number, el: HTMLVideoElement | null) => void
}

export interface PuzzleGridHandle {
  /** Swap every tile currently showing the given type for new media of the same type. */
  replaceAllOfType: (type: 'video' | 'image') => void
}

const GRID_PRESETS = {
  '2x2': { cols: 2, rows: 2 },
  '3x3': { cols: 3, rows: 3 },
  '4x4': { cols: 4, rows: 4 }
}

export const PuzzleGrid = forwardRef<PuzzleGridHandle, PuzzleGridProps>(function PuzzleGrid(
  { files, layoutMode, density, volume, onVideoRef },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [tiles, setTiles] = useState<TilePosition[]>([])
  const [tileMedia, setTileMedia] = useState<Map<number, MediaFile>>(new Map())
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const usedFiles = useRef(new Set<string>())

  // Observe container size
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setContainerSize({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Generate layout when size/mode/density changes
  useEffect(() => {
    if (containerSize.width === 0 || containerSize.height === 0) return

    let newTiles: TilePosition[]

    if (layoutMode === 'puzzle') {
      newTiles = generatePuzzleLayout({
        containerWidth: containerSize.width,
        containerHeight: containerSize.height,
        tileCount: Math.max(files.length, 50),
        density,
        gap: 2
      })
    } else {
      const preset = GRID_PRESETS[layoutMode]
      newTiles = generateUniformLayout(
        containerSize.width,
        containerSize.height,
        preset.cols,
        preset.rows,
        2
      )
    }

    setTiles(newTiles)

    const newMap = new Map<number, MediaFile>()
    usedFiles.current.clear()
    const shuffled = [...files].sort(() => Math.random() - 0.5)

    for (let i = 0; i < newTiles.length && i < shuffled.length; i++) {
      newMap.set(newTiles[i].id, shuffled[i])
      usedFiles.current.add(shuffled[i].path)
    }
    setTileMedia(newMap)
  }, [containerSize, layoutMode, density, files])

  const pickReplacement = useCallback(
    (preferType?: 'video' | 'image', exclude?: string): MediaFile | null => {
      if (files.length === 0) return null

      const filterType = (arr: MediaFile[]) =>
        preferType ? arr.filter((f) => f.type === preferType) : arr
      const notExcluded = (arr: MediaFile[]) =>
        exclude ? arr.filter((f) => f.path !== exclude) : arr

      const unused = filterType(notExcluded(files.filter((f) => !usedFiles.current.has(f.path))))
      if (unused.length > 0) return unused[Math.floor(Math.random() * unused.length)]

      const anyOfType = filterType(notExcluded(files))
      if (anyOfType.length > 0) return anyOfType[Math.floor(Math.random() * anyOfType.length)]

      // Fall back to any file (e.g. the user added only one type, or only one video)
      const any = notExcluded(files)
      if (any.length > 0) return any[Math.floor(Math.random() * any.length)]
      return files[0]
    },
    [files]
  )

  // Replace a single tile (used by both natural end-of-media and click-to-swap).
  const replaceTile = useCallback(
    (tileId: number, preferType?: 'video' | 'image') => {
      setTileMedia((prev) => {
        const old = prev.get(tileId)
        const next = pickReplacement(preferType ?? old?.type, old?.path)
        if (!next) return prev
        const map = new Map(prev)
        if (old) usedFiles.current.delete(old.path)
        map.set(tileId, next)
        usedFiles.current.add(next.path)
        return map
      })
    },
    [pickReplacement]
  )

  const handleMediaEnded = useCallback(
    (tileId: number) => {
      // Natural end: pull any unused file, no type preference.
      setTileMedia((prev) => {
        const old = prev.get(tileId)
        const next = pickReplacement(undefined, old?.path)
        if (!next) return prev
        const map = new Map(prev)
        if (old) usedFiles.current.delete(old.path)
        map.set(tileId, next)
        usedFiles.current.add(next.path)
        return map
      })
    },
    [pickReplacement]
  )

  const handleTileClick = useCallback(
    (tileId: number) => {
      // Click swap keeps the same type so the video/image mix stays stable.
      replaceTile(tileId)
    },
    [replaceTile]
  )

  useImperativeHandle(
    ref,
    () => ({
      replaceAllOfType: (type) => {
        setTileMedia((prev) => {
          const map = new Map(prev)
          const matchingTiles: number[] = []
          for (const [id, media] of prev) {
            if (media.type === type) matchingTiles.push(id)
          }
          if (matchingTiles.length === 0) return prev

          // Free up the slots first so the replacement pool is as wide as possible.
          for (const id of matchingTiles) {
            const old = map.get(id)
            if (old) usedFiles.current.delete(old.path)
          }

          for (const id of matchingTiles) {
            const old = map.get(id)
            const next = pickReplacement(type, old?.path)
            if (!next) continue
            map.set(id, next)
            usedFiles.current.add(next.path)
          }
          return map
        })
      }
    }),
    [pickReplacement]
  )

  return (
    <div ref={containerRef} className="relative w-full h-full bg-bg-primary overflow-hidden">
      {tiles.map((tile) => {
        const media = tileMedia.get(tile.id)
        return (
          <VideoTile
            key={tile.id}
            tile={tile}
            src={media?.path ?? null}
            mediaType={media?.type ?? 'video'}
            volume={volume}
            onEnded={handleMediaEnded}
            onClick={handleTileClick}
            onVideoRef={onVideoRef}
          />
        )
      })}

      {files.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-text-disabled text-sm">Add folders to start playing media</p>
        </div>
      )}
    </div>
  )
})
