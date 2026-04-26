import { useCallback } from 'react'
import { useStore, LABEL_CATEGORIES } from '../../lib/store'
import { useWebSocket } from '../../hooks/useWebSocket'
import { GlitchText } from '../shared/GlitchText'
import { NeonButton } from '../shared/NeonButton'
import { ErrorBoundary } from '../shared/ErrorBoundary'
import { DetectionClassPanel } from './DetectionClassPanel'
import { LayerStackPanel } from './LayerStackPanel'

export function CensorPage() {
  const censor = useStore((s) => s.censor)
  const setEnabledClasses = useStore((s) => s.setEnabledClasses)
  const { send, connected } = useWebSocket()

  const toggleCensor = useCallback(() => {
    if (censor.isActive) {
      send('censor.stop')
    } else {
      send('censor.settings', {
        enabled_classes: Array.from(censor.enabledClasses),
        censor_type: censor.censorType,
        intensity: censor.intensity,
        confidence_threshold: censor.confidenceThreshold,
        master_size: censor.masterSize,
        master_shape: censor.masterShape,
        master_stroke: censor.masterStroke,
        master_base_image: censor.masterBaseImage,
        master_overlay_image: censor.masterOverlayImage,
        master_text: censor.masterText,
        stroke_targets: censor.strokeTargets,
        per_category_size: censor.perCategorySize,
        master_feather_px: censor.masterFeatherPx
      })
      send('censor.start')
    }
  }, [censor, send])

  const selectAllExposed = useCallback(() => {
    const exposed = Object.values(LABEL_CATEGORIES)
      .flat()
      .filter((l) => l.includes('EXPOSED'))
    setEnabledClasses(exposed)
    if (censor.isActive) send('censor.settings', { enabled_classes: exposed })
  }, [setEnabledClasses, censor.isActive, send])

  const selectAll = useCallback(() => {
    const all = Object.values(LABEL_CATEGORIES).flat()
    setEnabledClasses(all)
    if (censor.isActive) send('censor.settings', { enabled_classes: all })
  }, [setEnabledClasses, censor.isActive, send])

  const clearAll = useCallback(() => {
    setEnabledClasses([])
    if (censor.isActive) send('censor.settings', { enabled_classes: [] })
  }, [setEnabledClasses, censor.isActive, send])

  return (
    <div className="flex flex-col h-full p-4 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <GlitchText
          text="CENSOR"
          className="text-2xl font-bold text-neon-pink text-glow-pink font-[Orbitron,var(--font-mono)]"
        />
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-secondary">FPS:</span>
            <span className="text-xs text-neon-green font-bold tabular-nums">
              {censor.fps.toFixed(0)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-secondary">DETECTIONS:</span>
            <span className="text-xs text-neon-cyan font-bold tabular-nums">
              {censor.detectionCount}
            </span>
          </div>
          <div
            className={`w-2.5 h-2.5 rounded-full pulse-indicator ${
              censor.isActive ? 'bg-neon-green text-neon-green' : 'bg-neon-red text-neon-red'
            }`}
          />
        </div>
      </div>

      {/* Big Toggle */}
      <button
        onClick={toggleCensor}
        disabled={!connected}
        className={`
          w-full py-4 border-2 font-mono text-sm tracking-[0.2em] uppercase
          transition-all duration-200 cursor-pointer shrink-0
          ${
            censor.isActive
              ? 'border-neon-red text-neon-red bg-neon-red/10 hover:bg-neon-red/20 shadow-[0_0_20px_#ff224440]'
              : 'border-neon-pink text-neon-pink bg-neon-pink/10 hover:bg-neon-pink/20 shadow-[0_0_20px_#ff006640]'
          }
          ${!connected ? 'opacity-40 cursor-not-allowed' : ''}
        `}
      >
        {censor.isActive ? '■  STOP CENSORSHIP' : '▶  START CENSORSHIP'}
      </button>

      {/* Content */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Left: detection class selection */}
        <div className="flex-[2] overflow-y-auto pr-2">
          <div className="flex gap-2 mb-3">
            <NeonButton size="sm" onClick={selectAllExposed}>
              All Exposed
            </NeonButton>
            <NeonButton size="sm" variant="cyan" onClick={selectAll}>
              Select All
            </NeonButton>
            <NeonButton size="sm" variant="red" onClick={clearAll}>
              Clear
            </NeonButton>
          </div>
          <DetectionClassPanel />
        </div>

        {/* Right: layer stack (this div IS the scroll container) */}
        <div className="flex-1 max-w-[360px] min-w-[280px] min-h-0 bg-bg-secondary border border-border-subtle rounded overflow-y-auto">
          <ErrorBoundary label="Layer stack">
            <LayerStackPanel />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  )
}
