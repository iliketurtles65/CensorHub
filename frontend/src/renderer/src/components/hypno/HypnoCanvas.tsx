import { useRef, useEffect, useState, useCallback, useMemo } from 'react'

interface MediaFile {
  path: string
  name: string
  type: 'video' | 'image'
  size: number
}

type ContentType = 'all' | 'video' | 'image'

interface TextStyle {
  color: string
  sizePct: number
  strokeEnabled: boolean
  strokeColor: string
  glowEnabled: boolean
  glowColor: string
}

interface HypnoCanvasProps {
  visualEffects: string[]
  intensity: number
  speed: number
  files: MediaFile[]
  volume: number
  videoDurationSec: number
  imageDurationSec: number
  playVideosToEnd: boolean
  contentType: ContentType
  textOverlayEnabled: boolean
  phrases: string[]
  phraseIntervalSec: number
  phraseRandomOrder: boolean
  textStyle: TextStyle
  onVideoRef?: (el: HTMLVideoElement | null) => void
}

function getMediaUrl(filePath: string): string {
  return `local-media://media/${encodeURIComponent(filePath)}`
}

export function HypnoCanvas({
  visualEffects,
  intensity,
  speed,
  files,
  volume,
  videoDurationSec,
  imageDurationSec,
  playVideosToEnd,
  contentType,
  textOverlayEnabled,
  phrases,
  phraseIntervalSec,
  phraseRandomOrder,
  textStyle,
  onVideoRef
}: HypnoCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const animRef = useRef<number>(0)
  const timeRef = useRef(0)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [currentPhraseIdx, setCurrentPhraseIdx] = useState(0)

  const filtered = useMemo(() => {
    if (contentType === 'all') return files
    return files.filter((f) => f.type === contentType)
  }, [files, contentType])

  const currentFile = filtered.length > 0 ? filtered[currentIndex % filtered.length] : null
  const mediaSrc = currentFile ? getMediaUrl(currentFile.path) : null

  const handleNext = useCallback(() => {
    if (filtered.length === 0) return
    setCurrentIndex((prev) => {
      if (filtered.length === 1) return prev
      let next = Math.floor(Math.random() * filtered.length)
      if (next === prev) next = (next + 1) % filtered.length
      return next
    })
  }, [filtered.length])

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = Math.max(0, Math.min(1, volume))
    }
  }, [volume])

  // Set crossOrigin before src to keep Web Audio path CORS-clean.
  useEffect(() => {
    const el = videoRef.current
    if (!el || !mediaSrc || currentFile?.type !== 'video') return
    if (el.crossOrigin !== 'anonymous') el.crossOrigin = 'anonymous'
    if (el.src !== mediaSrc) el.src = mediaSrc
  }, [mediaSrc, currentFile])

  useEffect(() => {
    onVideoRef?.(videoRef.current)
    return () => onVideoRef?.(null)
  }, [onVideoRef, currentFile])

  // Timed advance.
  //   - image → always swap on imageDurationSec.
  //   - video + playVideosToEnd → wait for `onEnded` (no timer here).
  //   - video + !playVideosToEnd → swap on videoDurationSec.
  useEffect(() => {
    if (!currentFile) return
    let seconds: number
    if (currentFile.type === 'image') {
      seconds = imageDurationSec
    } else if (playVideosToEnd) {
      return
    } else {
      seconds = videoDurationSec
    }
    const ms = Math.max(0.1, seconds) * 1000
    const timer = setTimeout(handleNext, ms)
    return () => clearTimeout(timer)
  }, [currentFile, imageDurationSec, videoDurationSec, playVideosToEnd, handleNext])

  // Clamp index when filtered list shrinks so we don't index out of range.
  useEffect(() => {
    if (filtered.length === 0) return
    if (currentIndex >= filtered.length) setCurrentIndex(0)
  }, [filtered.length, currentIndex])

  // Phrase rotation — only runs when Text Overlay is enabled and there are phrases.
  useEffect(() => {
    if (!textOverlayEnabled || phrases.length === 0) return
    const ms = Math.max(0.1, phraseIntervalSec) * 1000
    const id = setInterval(() => {
      setCurrentPhraseIdx((prev) => {
        if (phrases.length <= 1) return 0
        if (phraseRandomOrder) {
          let next = Math.floor(Math.random() * phrases.length)
          if (next === prev) next = (next + 1) % phrases.length
          return next
        }
        return (prev + 1) % phrases.length
      })
    }, ms)
    return () => clearInterval(id)
  }, [textOverlayEnabled, phrases.length, phraseIntervalSec, phraseRandomOrder])

  // Keep current phrase index in range when phrases shrink.
  useEffect(() => {
    if (phrases.length === 0) return
    if (currentPhraseIdx >= phrases.length) setCurrentPhraseIdx(0)
  }, [phrases.length, currentPhraseIdx])

  const currentPhrase =
    textOverlayEnabled && phrases.length > 0 ? phrases[currentPhraseIdx % phrases.length] : null

  // Canvas effects rendering
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')!
    let running = true

    const resize = () => {
      const rect = canvas.parentElement!.getBoundingClientRect()
      canvas.width = rect.width
      canvas.height = rect.height
    }
    resize()

    const observer = new ResizeObserver(resize)
    observer.observe(canvas.parentElement!)

    const render = () => {
      if (!running) return
      const dt = 0.016 * (speed / 50)
      timeRef.current += dt

      const w = canvas.width
      const h = canvas.height
      const t = timeRef.current
      const int = intensity / 100

      ctx.clearRect(0, 0, w, h)

      if (visualEffects.includes('Spiral Overlay')) drawSpiral(ctx, w, h, t, int)
      if (visualEffects.includes('Color Cycling')) drawColorCycle(ctx, w, h, t, int)
      if (visualEffects.includes('Tunnel Effect')) drawTunnel(ctx, w, h, t, int)
      if (visualEffects.includes('Edge Glow')) drawEdgeGlow(ctx, w, h, t, int)
      if (visualEffects.includes('Strobe Flash')) drawStrobe(ctx, w, h, t, int)
      if (visualEffects.includes('Wave Distortion')) drawWave(ctx, w, h, t, int)
      if (visualEffects.includes('Zoom Pulse')) drawZoomPulse(ctx, w, h, t, int)
      if (currentPhrase) drawText(ctx, w, h, t, currentPhrase, textStyle)

      if (files.length === 0 && visualEffects.length === 0) {
        ctx.fillStyle = '#12121a'
        ctx.fillRect(0, 0, w, h)
        ctx.font = '14px "JetBrains Mono", monospace'
        ctx.fillStyle = '#444466'
        ctx.textAlign = 'center'
        ctx.fillText('Add folders and enable effects to begin', w / 2, h / 2)
      }

      animRef.current = requestAnimationFrame(render)
    }

    animRef.current = requestAnimationFrame(render)

    return () => {
      running = false
      cancelAnimationFrame(animRef.current)
      observer.disconnect()
    }
  }, [visualEffects, intensity, speed, files.length, currentPhrase, textStyle])

  return (
    <div
      className="relative w-full h-full bg-black rounded overflow-hidden cursor-pointer"
      onClick={handleNext}
    >
      {mediaSrc && currentFile?.type === 'video' && (
        <video
          ref={videoRef}
          key={mediaSrc}
          crossOrigin="anonymous"
          autoPlay
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
          onEnded={playVideosToEnd ? handleNext : undefined}
          onError={handleNext}
        />
      )}
      {mediaSrc && currentFile?.type === 'image' && (
        <img
          key={mediaSrc}
          src={mediaSrc}
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
          alt=""
          onError={handleNext}
        />
      )}

      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 40%, rgba(10,10,15,0.8) 100%)'
        }}
      />
    </div>
  )
}

function drawText(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  text: string,
  style: TextStyle
) {
  const size = Math.max(14, Math.floor(Math.min(w, h) * (style.sizePct / 100)))
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `900 ${size}px "Orbitron", "Impact", sans-serif`

  const pulse = 0.88 + 0.12 * Math.sin(t * 2.5)
  ctx.globalAlpha = pulse

  if (style.strokeEnabled) {
    ctx.lineWidth = Math.max(3, Math.floor(size * 0.09))
    ctx.strokeStyle = style.strokeColor
    ctx.strokeText(text, w / 2, h / 2)
  }

  if (style.glowEnabled) {
    ctx.shadowColor = style.glowColor
    ctx.shadowBlur = 24
  }
  ctx.fillStyle = style.color
  ctx.fillText(text, w / 2, h / 2)

  ctx.restore()
}

function drawSpiral(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  intensity: number
) {
  const cx = w / 2
  const cy = h / 2
  const maxRadius = Math.max(w, h) * 0.7

  ctx.save()
  ctx.globalAlpha = 0.6 * intensity
  ctx.strokeStyle = '#ff0066'
  ctx.lineWidth = 2

  ctx.beginPath()
  for (let angle = 0; angle < Math.PI * 12; angle += 0.05) {
    const r = (angle / (Math.PI * 12)) * maxRadius
    const x = cx + r * Math.cos(angle + t)
    const y = cy + r * Math.sin(angle + t)
    if (angle === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()

  ctx.strokeStyle = '#00f0ff'
  ctx.beginPath()
  for (let angle = 0; angle < Math.PI * 12; angle += 0.05) {
    const r = (angle / (Math.PI * 12)) * maxRadius
    const x = cx + r * Math.cos(angle + t + Math.PI)
    const y = cy + r * Math.sin(angle + t + Math.PI)
    if (angle === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()

  ctx.restore()
}

function drawColorCycle(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  intensity: number
) {
  const hue = (t * 30) % 360
  ctx.save()
  ctx.globalAlpha = 0.15 * intensity
  ctx.fillStyle = `hsl(${hue}, 80%, 50%)`
  ctx.fillRect(0, 0, w, h)
  ctx.restore()
}

function drawTunnel(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  intensity: number
) {
  const cx = w / 2
  const cy = h / 2

  ctx.save()
  ctx.globalAlpha = 0.5 * intensity

  for (let i = 20; i > 0; i--) {
    const scale = (i / 20 + t * 0.1) % 1
    const size = scale * Math.max(w, h)
    ctx.strokeStyle = i % 2 === 0 ? '#ff006660' : '#00f0ff40'
    ctx.lineWidth = 1
    ctx.strokeRect(cx - size / 2, cy - size / 2, size, size)
  }

  ctx.restore()
}

function drawEdgeGlow(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  intensity: number
) {
  const glow = 30 * intensity
  const pulse = 0.7 + 0.3 * Math.sin(t * 2)

  ctx.save()
  ctx.globalAlpha = pulse

  const gradT = ctx.createLinearGradient(0, 0, 0, glow)
  gradT.addColorStop(0, `rgba(255, 0, 102, ${0.3 * intensity})`)
  gradT.addColorStop(1, 'transparent')
  ctx.fillStyle = gradT
  ctx.fillRect(0, 0, w, glow)

  const gradB = ctx.createLinearGradient(0, h, 0, h - glow)
  gradB.addColorStop(0, `rgba(0, 240, 255, ${0.3 * intensity})`)
  gradB.addColorStop(1, 'transparent')
  ctx.fillStyle = gradB
  ctx.fillRect(0, h - glow, w, glow)

  ctx.restore()
}

function drawStrobe(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  intensity: number
) {
  const period = 1.5
  const phase = t % period
  if (phase < 0.05) {
    ctx.save()
    ctx.globalAlpha = 0.3 * intensity
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  }
}

function drawWave(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  intensity: number
) {
  ctx.save()
  ctx.globalAlpha = 0.4 * intensity
  ctx.strokeStyle = '#ff0066'
  ctx.lineWidth = 2

  for (let y = 0; y < h; y += 20) {
    ctx.beginPath()
    for (let x = 0; x < w; x += 4) {
      const offset = Math.sin((y + t * 50) * 0.03) * 20 * intensity
      const py = y + Math.sin((x + t * 100) * 0.02) * 10 * intensity
      if (x === 0) ctx.moveTo(x + offset, py)
      else ctx.lineTo(x + offset, py)
    }
    ctx.stroke()
  }

  ctx.restore()
}

function drawZoomPulse(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  intensity: number
) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 3)
  const radius = Math.max(w, h) * 0.3 * pulse * intensity

  ctx.save()
  ctx.globalAlpha = 0.2 * intensity

  const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, radius)
  grad.addColorStop(0, '#ff006640')
  grad.addColorStop(0.5, '#00f0ff20')
  grad.addColorStop(1, 'transparent')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)

  ctx.restore()
}
