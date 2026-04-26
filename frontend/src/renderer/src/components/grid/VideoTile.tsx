import { useRef, useCallback, useEffect } from 'react'
import { type TilePosition } from '../../lib/puzzleLayout'

interface VideoTileProps {
  tile: TilePosition
  src: string | null
  mediaType: 'video' | 'image'
  volume: number
  onEnded: (tileId: number) => void
  onClick?: (tileId: number) => void
  onVideoRef?: (tileId: number, el: HTMLVideoElement | null) => void
}

function getMediaUrl(filePath: string): string {
  return `local-media://media/${encodeURIComponent(filePath)}`
}

export function VideoTile({
  tile,
  src,
  mediaType,
  volume,
  onEnded,
  onClick,
  onVideoRef
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  const handleEnded = useCallback(() => onEnded(tile.id), [tile.id, onEnded])
  const handleClick = useCallback(() => onClick?.(tile.id), [tile.id, onClick])

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = Math.max(0, Math.min(1, volume))
    }
  }, [volume])

  // Set crossOrigin and src IMPERATIVELY. React's attribute-commit order
  // isn't a strict guarantee, and if the browser begins loading `src` before
  // `crossOrigin="anonymous"` is in place, the load is non-CORS, and
  // `createMediaElementSource` then produces silenced output for that element.
  // Doing it here ensures `crossOrigin` is on the element before any `src`
  // assignment triggers a load, every time.
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    if (el.crossOrigin !== 'anonymous') el.crossOrigin = 'anonymous'
    if (src) {
      const target = getMediaUrl(src)
      if (el.src !== target) el.src = target
    }
  }, [src])

  // Expose video ref to parent. Runs after the crossOrigin+src effect above,
  // so by the time the parent attaches the Web Audio source, the element is
  // in CORS mode. Re-runs on src change as well so the parent can re-verify
  // the engine's chain wiring for this element (the engine is idempotent).
  useEffect(() => {
    onVideoRef?.(tile.id, videoRef.current)
    return () => onVideoRef?.(tile.id, null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tile.id, src])

  if (!src) {
    return (
      <div
        className="absolute bg-bg-secondary border border-border-subtle/30 flex items-center justify-center"
        style={{
          left: tile.x,
          top: tile.y,
          width: tile.width,
          height: tile.height
        }}
      >
        <span className="text-text-disabled text-xs">EMPTY</span>
      </div>
    )
  }

  return (
    <div
      className="absolute overflow-hidden bg-black cursor-pointer"
      style={{
        left: tile.x,
        top: tile.y,
        width: tile.width,
        height: tile.height
      }}
      onClick={handleClick}
    >
      {mediaType === 'video' ? (
        <video
          ref={videoRef}
          crossOrigin="anonymous"
          autoPlay
          preload="auto"
          className="w-full h-full object-cover pointer-events-none"
          onEnded={handleEnded}
          onError={handleEnded}
          // src is intentionally set imperatively above so crossOrigin lands first
        />
      ) : (
        <img
          className="w-full h-full object-cover pointer-events-none"
          alt=""
          onLoad={() => {
            setTimeout(() => onEnded(tile.id), 5000)
          }}
          onError={() => onEnded(tile.id)}
          src={getMediaUrl(src)}
        />
      )}
    </div>
  )
}
