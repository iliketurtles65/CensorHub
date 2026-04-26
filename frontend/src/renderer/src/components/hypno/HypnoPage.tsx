import { useState, useEffect, useCallback, useRef } from 'react'
import { useStore } from '../../lib/store'
import { useWebSocket } from '../../hooks/useWebSocket'
import { useAudioDSP } from '../../hooks/useAudioDSP'
import { GlitchText } from '../shared/GlitchText'
import { NeonCheckbox } from '../shared/NeonCheckbox'
import { NeonSlider } from '../shared/NeonSlider'
import { NeonSelect } from '../shared/NeonSelect'
import { ColorPicker } from '../shared/ColorPicker'
import { FolderManager } from '../grid/FolderManager'
import { HypnoCanvas } from './HypnoCanvas'

interface MediaFile {
  path: string
  name: string
  type: 'video' | 'image'
  size: number
}

const VISUAL_EFFECTS = [
  'Spiral Overlay',
  'Color Cycling',
  'Kaleidoscope',
  'Wave Distortion',
  'Chromatic Aberration',
  'VHS Glitch',
  'Zoom Pulse',
  'Edge Glow',
  'Strobe Flash',
  'Tunnel Effect'
]

const AUDIO_EFFECTS = [
  'Binaural Beats',
  'Heavy Reverb',
  'Echo',
  'Auto-pan',
  'Sub-bass Drone',
  'Distortion',
  'Low-Pass Filter'
]

const CONTENT_OPTIONS = [
  { value: 'all', label: 'Video + Image' },
  { value: 'video', label: 'Video Only' },
  { value: 'image', label: 'Image Only' }
]

function formatSeconds(s: number): string {
  return s % 1 === 0 ? `${s}s` : `${s.toFixed(1)}s`
}

// Small reusable header + action button styled consistently across sections.
function SectionHeader({
  title,
  action
}: {
  title: string
  action?: { label: string; onClick: () => void; danger?: boolean }
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-xs text-neon-cyan uppercase tracking-[0.2em] text-glow-cyan">{title}</h3>
      {action && (
        <button
          onClick={action.onClick}
          className={`text-[10px] px-2 py-0.5 uppercase tracking-wider border rounded transition-colors ${
            action.danger
              ? 'text-neon-red border-neon-red/50 hover:bg-neon-red/10'
              : 'text-neon-cyan border-neon-cyan/50 hover:bg-neon-cyan/10 hover:shadow-[0_0_8px_#00f0ff40]'
          }`}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

export function HypnoPage() {
  const hypno = useStore((s) => s.hypno)
  const addHypnoFolder = useStore((s) => s.addHypnoFolder)
  const removeHypnoFolder = useStore((s) => s.removeHypnoFolder)
  const toggleVisualEffect = useStore((s) => s.toggleHypnoVisualEffect)
  const setHypnoVisualEffects = useStore((s) => s.setHypnoVisualEffects)
  const toggleAudioEffect = useStore((s) => s.toggleHypnoAudioEffect)
  const setHypnoAudioEffectIntensity = useStore((s) => s.setHypnoAudioEffectIntensity)
  const setIntensity = useStore((s) => s.setHypnoIntensity)
  const setSpeed = useStore((s) => s.setHypnoSpeed)
  const setHypnoVideoDuration = useStore((s) => s.setHypnoVideoDuration)
  const setHypnoImageDuration = useStore((s) => s.setHypnoImageDuration)
  const setHypnoPlayVideosToEnd = useStore((s) => s.setHypnoPlayVideosToEnd)
  const setHypnoContentType = useStore((s) => s.setHypnoContentType)
  const addHypnoPhrase = useStore((s) => s.addHypnoPhrase)
  const removeHypnoPhraseAt = useStore((s) => s.removeHypnoPhraseAt)
  const clearHypnoPhrases = useStore((s) => s.clearHypnoPhrases)
  const setHypnoPhraseInterval = useStore((s) => s.setHypnoPhraseInterval)
  const setHypnoPhraseRandomOrder = useStore((s) => s.setHypnoPhraseRandomOrder)
  const setHypnoTextOverlayEnabled = useStore((s) => s.setHypnoTextOverlayEnabled)
  const setHypnoTextColor = useStore((s) => s.setHypnoTextColor)
  const setHypnoTextSizePct = useStore((s) => s.setHypnoTextSizePct)
  const setHypnoTextStrokeEnabled = useStore((s) => s.setHypnoTextStrokeEnabled)
  const setHypnoTextStrokeColor = useStore((s) => s.setHypnoTextStrokeColor)
  const setHypnoTextGlowEnabled = useStore((s) => s.setHypnoTextGlowEnabled)
  const setHypnoTextGlowColor = useStore((s) => s.setHypnoTextGlowColor)

  const { send, subscribe } = useWebSocket()
  const [files, setFiles] = useState<MediaFile[]>([])
  const [volume, setVolume] = useState(0.5)
  const [phraseInput, setPhraseInput] = useState('')

  const audioDSP = useAudioDSP(hypno.audioEffects, hypno.audioEffectIntensities)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    if (hypno.folders.length === 0) {
      setFiles([])
      return
    }
    send('media.scan_folders', { folders: hypno.folders })
  }, [hypno.folders, send])

  useEffect(() => {
    const unsub = subscribe('media.file_list', (data: any) => {
      setFiles(data.files || [])
    })
    return unsub
  }, [subscribe])

  const handleVideoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el
      if (el) audioDSP.connectElement(el)
    },
    [audioDSP]
  )

  const handleAddPhrase = () => {
    if (phraseInput.trim()) {
      addHypnoPhrase(phraseInput)
      setPhraseInput('')
    }
  }

  const allVisualOn = hypno.visualEffects.length === VISUAL_EFFECTS.length
  const toggleAllVisual = () => {
    setHypnoVisualEffects(allVisualOn ? [] : [...VISUAL_EFFECTS])
  }

  const textStyle = {
    color: hypno.textColor,
    sizePct: hypno.textSizePct,
    strokeEnabled: hypno.textStrokeEnabled,
    strokeColor: hypno.textStrokeColor,
    glowEnabled: hypno.textGlowEnabled,
    glowColor: hypno.textGlowColor
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 shrink-0">
          <GlitchText
            text="HYPNO"
            className="text-xl font-bold text-neon-pink text-glow-pink font-[Orbitron,var(--font-mono)]"
          />
          <span className="text-xs text-text-secondary">
            {files.length} files from {hypno.folders.length} folder(s)
          </span>
        </div>
        <div className="flex-1 min-h-0 px-1 pb-1">
          <HypnoCanvas
            visualEffects={hypno.visualEffects}
            intensity={hypno.effectIntensity}
            speed={hypno.speed}
            files={files}
            volume={volume}
            videoDurationSec={hypno.videoDurationSec}
            imageDurationSec={hypno.imageDurationSec}
            playVideosToEnd={hypno.playVideosToEnd}
            contentType={hypno.contentType}
            textOverlayEnabled={hypno.textOverlayEnabled}
            phrases={hypno.phrases}
            phraseIntervalSec={hypno.phraseIntervalSec}
            phraseRandomOrder={hypno.phraseRandomOrder}
            textStyle={textStyle}
            onVideoRef={handleVideoRef}
          />
        </div>
      </div>

      <div className="w-72 border-l border-border-subtle bg-bg-secondary/50 p-4 flex flex-col gap-5 overflow-y-auto">
        <FolderManager
          folders={hypno.folders}
          onAdd={addHypnoFolder}
          onRemove={removeHypnoFolder}
        />

        {/* Content */}
        <div className="bg-bg-secondary border border-border-subtle rounded-md p-4">
          <SectionHeader title="Content" />
          <NeonSelect
            label=""
            value={hypno.contentType}
            options={CONTENT_OPTIONS}
            onChange={(v) => setHypnoContentType(v as any)}
          />
          {hypno.contentType !== 'image' && (
            <div className="mt-4">
              <NeonSlider
                label="Video length"
                value={hypno.videoDurationSec}
                min={0.5}
                max={60}
                step={0.5}
                onChange={setHypnoVideoDuration}
                displayValue={formatSeconds(hypno.videoDurationSec)}
              />
              <div className="mt-3">
                <NeonCheckbox
                  label="Play videos to end"
                  checked={hypno.playVideosToEnd}
                  onChange={() => setHypnoPlayVideosToEnd(!hypno.playVideosToEnd)}
                />
              </div>
            </div>
          )}
          {hypno.contentType !== 'video' && (
            <div className="mt-4">
              <NeonSlider
                label="Image length"
                value={hypno.imageDurationSec}
                min={0.5}
                max={60}
                step={0.5}
                onChange={setHypnoImageDuration}
                displayValue={formatSeconds(hypno.imageDurationSec)}
              />
            </div>
          )}
          <p className="text-[10px] text-text-disabled tracking-wide mt-3">
            Tip: click the canvas to skip to the next clip.
          </p>
        </div>

        {/* Text Overlay */}
        <div className="bg-bg-secondary border border-border-subtle rounded-md p-4">
          <SectionHeader
            title="Text Overlay"
            action={
              hypno.phrases.length > 0
                ? { label: 'Clear', onClick: clearHypnoPhrases, danger: true }
                : undefined
            }
          />

          {/* Prominent enable toggle */}
          <div
            className={`flex items-center justify-between rounded-md border px-3 py-2 mb-3 transition-colors ${
              hypno.textOverlayEnabled
                ? 'border-neon-pink/60 bg-neon-pink/10 shadow-[0_0_10px_#ff006640]'
                : 'border-border-subtle bg-bg-primary'
            }`}
          >
            <NeonCheckbox
              label="Enable"
              checked={hypno.textOverlayEnabled}
              onChange={() => setHypnoTextOverlayEnabled(!hypno.textOverlayEnabled)}
            />
            <span
              className={`text-[10px] uppercase tracking-wider font-bold ${
                hypno.textOverlayEnabled ? 'text-neon-pink' : 'text-text-disabled'
              }`}
            >
              {hypno.textOverlayEnabled ? 'ON' : 'OFF'}
            </span>
          </div>

          <div className="flex gap-1.5">
            <input
              type="text"
              value={phraseInput}
              onChange={(e) => setPhraseInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddPhrase()
              }}
              placeholder="add phrase…"
              className="flex-1 min-w-0 bg-bg-primary border border-border-subtle rounded px-2 py-1.5 text-xs text-text-primary outline-none focus:border-neon-pink focus:shadow-[0_0_8px_#ff006630]"
            />
            <button
              onClick={handleAddPhrase}
              aria-label="Add phrase"
              className="shrink-0 w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-neon-pink text-neon-pink text-xl font-bold leading-none rounded hover:bg-neon-pink/15 hover:shadow-[0_0_10px_#ff006650] transition-all duration-150 cursor-pointer"
            >
              +
            </button>
          </div>

          {hypno.phrases.length === 0 ? (
            <p className="text-[11px] text-text-disabled py-3 text-center">
              No phrases yet — add some to see them rotate on the canvas.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto mt-3">
              {hypno.phrases.map((p, i) => (
                <div
                  key={`${i}-${p}`}
                  className="flex items-center justify-between bg-bg-primary border-l-2 border-neon-pink rounded px-3 py-1.5 group hover:bg-neon-pink/5 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[9px] font-mono text-neon-cyan/70 tabular-nums shrink-0">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="text-xs text-text-primary truncate" title={p}>
                      {p}
                    </span>
                  </div>
                  <button
                    onClick={() => removeHypnoPhraseAt(i)}
                    className="text-text-disabled hover:text-neon-red text-xs shrink-0 ml-2 opacity-50 group-hover:opacity-100 transition-opacity"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4">
            <NeonSlider
              label="Swap"
              value={hypno.phraseIntervalSec}
              min={0.5}
              max={30}
              step={0.5}
              onChange={setHypnoPhraseInterval}
              displayValue={formatSeconds(hypno.phraseIntervalSec)}
            />
            <div className="mt-3">
              <NeonCheckbox
                label="Random order"
                checked={hypno.phraseRandomOrder}
                onChange={() => setHypnoPhraseRandomOrder(!hypno.phraseRandomOrder)}
              />
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-border-subtle/50">
            <p className="text-[10px] text-neon-cyan uppercase tracking-[0.2em] mb-3">Text style</p>
            <NeonSlider
              label="Size"
              value={hypno.textSizePct}
              min={2}
              max={25}
              onChange={setHypnoTextSizePct}
              displayValue={`${hypno.textSizePct}%`}
            />
            <div className="mt-3">
              <ColorPicker
                label="Text color"
                value={hypno.textColor}
                onChange={setHypnoTextColor}
              />
            </div>

            <div className="mt-4">
              <NeonCheckbox
                label="Outline"
                checked={hypno.textStrokeEnabled}
                onChange={() => setHypnoTextStrokeEnabled(!hypno.textStrokeEnabled)}
              />
              {hypno.textStrokeEnabled && (
                <div className="mt-2 pl-5">
                  <ColorPicker value={hypno.textStrokeColor} onChange={setHypnoTextStrokeColor} />
                </div>
              )}
            </div>

            <div className="mt-3">
              <NeonCheckbox
                label="Glow"
                checked={hypno.textGlowEnabled}
                onChange={() => setHypnoTextGlowEnabled(!hypno.textGlowEnabled)}
              />
              {hypno.textGlowEnabled && (
                <div className="mt-2 pl-5">
                  <ColorPicker value={hypno.textGlowColor} onChange={setHypnoTextGlowColor} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Visual FX */}
        <div className="bg-bg-secondary border border-border-subtle rounded-md p-4">
          <SectionHeader
            title="Visual FX"
            action={{
              label: allVisualOn ? 'None' : 'All',
              onClick: toggleAllVisual
            }}
          />
          <div className="flex flex-col gap-2">
            {VISUAL_EFFECTS.map((effect) => (
              <NeonCheckbox
                key={effect}
                label={effect}
                checked={hypno.visualEffects.includes(effect)}
                onChange={() => toggleVisualEffect(effect)}
              />
            ))}
          </div>
        </div>

        {/* Audio FX */}
        <div className="bg-bg-secondary border border-border-subtle rounded-md p-4">
          <SectionHeader title="Audio FX" />
          <div className="flex flex-col gap-2.5">
            {AUDIO_EFFECTS.map((effect) => {
              const enabled = hypno.audioEffects.includes(effect)
              const intensity = hypno.audioEffectIntensities[effect] ?? 0.5
              return (
                <div key={effect} className="flex flex-col gap-1.5">
                  <NeonCheckbox
                    label={effect}
                    checked={enabled}
                    onChange={() => toggleAudioEffect(effect)}
                  />
                  {enabled && (
                    <div className="pl-5">
                      <NeonSlider
                        label=""
                        value={Math.round(intensity * 100)}
                        onChange={(v) => setHypnoAudioEffectIntensity(effect, v / 100)}
                        displayValue={`${Math.round(intensity * 100)}%`}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Controls */}
        <div className="bg-bg-secondary border border-border-subtle rounded-md p-4">
          <SectionHeader title="Controls" />
          <NeonSlider
            label="Intensity"
            value={hypno.effectIntensity}
            onChange={setIntensity}
            displayValue={`${hypno.effectIntensity}%`}
          />
          <div className="mt-4">
            <NeonSlider
              label="Speed"
              value={hypno.speed}
              onChange={setSpeed}
              displayValue={`${hypno.speed}%`}
            />
          </div>
          <div className="mt-4">
            <NeonSlider
              label="Volume"
              value={Math.round(volume * 100)}
              onChange={(v) => setVolume(v / 100)}
              displayValue={`${Math.round(volume * 100)}%`}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
