import { useState, useEffect, useCallback, useRef } from 'react'
import { useStore } from '../../lib/store'
import { useWebSocket } from '../../hooks/useWebSocket'
import { useAudioDSP } from '../../hooks/useAudioDSP'
import { GlitchText } from '../shared/GlitchText'
import { NeonSlider } from '../shared/NeonSlider'
import { NeonSelect } from '../shared/NeonSelect'
import { NeonCheckbox } from '../shared/NeonCheckbox'
import { NeonButton } from '../shared/NeonButton'
import { FolderManager } from './FolderManager'
import { PuzzleGrid, type PuzzleGridHandle } from './PuzzleGrid'

interface MediaFile {
  path: string
  name: string
  type: 'video' | 'image'
  size: number
}

const LAYOUT_OPTIONS = [
  { value: 'puzzle', label: 'PUZZLE' },
  { value: '2x2', label: '2 x 2' },
  { value: '3x3', label: '3 x 3' },
  { value: '4x4', label: '4 x 4' }
]

const AUDIO_EFFECTS = [
  'Reverb',
  'Echo',
  'Low-Pass Filter',
  'High-Pass Filter',
  'Distortion',
  'Chorus',
  'Bitcrusher',
  'Compressor',
  'Stereo Pan'
]

export function GridPage() {
  const grid = useStore((s) => s.grid)
  const addGridFolder = useStore((s) => s.addGridFolder)
  const removeGridFolder = useStore((s) => s.removeGridFolder)
  const setGridLayout = useStore((s) => s.setGridLayout)
  const setGridDensity = useStore((s) => s.setGridDensity)
  const toggleGridAudioEffect = useStore((s) => s.toggleGridAudioEffect)
  const setGridAudioEffectIntensity = useStore((s) => s.setGridAudioEffectIntensity)

  const { send, subscribe } = useWebSocket()
  const [files, setFiles] = useState<MediaFile[]>([])
  const [volume, setVolume] = useState(0.3)

  const audioDSP = useAudioDSP(grid.audioEffects, grid.audioEffectIntensities)
  const videoRefs = useRef<Map<number, HTMLVideoElement>>(new Map())
  const puzzleGridRef = useRef<PuzzleGridHandle>(null)

  // Always connect newly-mounted videos. Cleanup only forgets the tile→element
  // map entry — we never try to tear down the audio source, because
  // `createMediaElementSource` is a one-shot call per element and the engine
  // needs to reuse the same source if React StrictMode re-mounts us.
  const handleVideoRef = useCallback(
    (tileId: number, el: HTMLVideoElement | null) => {
      if (el) {
        videoRefs.current.set(tileId, el)
        audioDSP.connectElement(el)
      } else {
        videoRefs.current.delete(tileId)
      }
    },
    [audioDSP]
  )

  useEffect(() => {
    if (grid.folders.length === 0) {
      setFiles([])
      return
    }
    send('media.scan_folders', { folders: grid.folders })
  }, [grid.folders, send])

  useEffect(() => {
    const unsub = subscribe('media.file_list', (data: any) => {
      setFiles(data.files || [])
    })
    return unsub
  }, [subscribe])

  const hasImages = files.some((f) => f.type === 'image')
  const hasVideos = files.some((f) => f.type === 'video')

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 shrink-0">
          <GlitchText
            text="GRID"
            className="text-xl font-bold text-neon-pink text-glow-pink font-[Orbitron,var(--font-mono)]"
          />
          <span className="text-xs text-text-secondary">
            {files.length} files from {grid.folders.length} folder(s)
          </span>
        </div>

        <div className="flex-1 min-h-0 px-1 pb-1">
          <PuzzleGrid
            ref={puzzleGridRef}
            files={files}
            layoutMode={grid.layoutMode}
            density={grid.density}
            volume={volume}
            onVideoRef={handleVideoRef}
          />
        </div>
      </div>

      <div className="w-64 border-l border-border-subtle bg-bg-secondary/50 p-3 flex flex-col gap-3 overflow-y-auto">
        <FolderManager
          folders={grid.folders}
          onAdd={addGridFolder}
          onRemove={removeGridFolder}
        />

        <div className="bg-bg-secondary border border-border-subtle rounded p-3">
          <h3 className="text-[10px] text-neon-cyan uppercase tracking-[0.2em] mb-2 text-glow-cyan">
            Layout
          </h3>
          <NeonSelect
            label=""
            value={grid.layoutMode}
            options={LAYOUT_OPTIONS}
            onChange={(v) => setGridLayout(v as any)}
          />
          {grid.layoutMode === 'puzzle' && (
            <NeonSlider
              label="Density"
              value={grid.density}
              onChange={setGridDensity}
              displayValue={`${grid.density}%`}
              className="mt-3"
            />
          )}
        </div>

        <div className="bg-bg-secondary border border-border-subtle rounded p-3">
          <h3 className="text-[10px] text-neon-cyan uppercase tracking-[0.2em] mb-2 text-glow-cyan">
            Shuffle
          </h3>
          <div className="flex flex-col gap-2">
            <NeonButton
              variant="cyan"
              size="sm"
              disabled={!hasVideos}
              onClick={() => puzzleGridRef.current?.replaceAllOfType('video')}
            >
              Change Videos
            </NeonButton>
            <NeonButton
              variant="cyan"
              size="sm"
              disabled={!hasImages}
              onClick={() => puzzleGridRef.current?.replaceAllOfType('image')}
            >
              Change Pictures
            </NeonButton>
            <p className="text-[9px] text-text-disabled tracking-wide mt-1">
              Tip: click any tile to swap just that one.
            </p>
          </div>
        </div>

        <div className="bg-bg-secondary border border-border-subtle rounded p-3">
          <h3 className="text-[10px] text-neon-cyan uppercase tracking-[0.2em] mb-2 text-glow-cyan">
            Volume
          </h3>
          <NeonSlider
            label="Master"
            value={Math.round(volume * 100)}
            onChange={(v) => setVolume(v / 100)}
            displayValue={`${Math.round(volume * 100)}%`}
          />
        </div>

        <div className="bg-bg-secondary border border-border-subtle rounded p-3">
          <h3 className="text-[10px] text-neon-cyan uppercase tracking-[0.2em] mb-2 text-glow-cyan">
            Audio DSP
          </h3>
          <div className="flex flex-col gap-1.5">
            {AUDIO_EFFECTS.map((effect) => {
              const enabled = grid.audioEffects.includes(effect)
              const intensity = grid.audioEffectIntensities[effect] ?? 0.5
              return (
                <div key={effect} className="flex flex-col gap-1">
                  <NeonCheckbox
                    label={effect}
                    checked={enabled}
                    onChange={() => toggleGridAudioEffect(effect)}
                  />
                  {enabled && (
                    <div className="pl-5">
                      <NeonSlider
                        label=""
                        value={Math.round(intensity * 100)}
                        onChange={(v) => setGridAudioEffectIntensity(effect, v / 100)}
                        displayValue={`${Math.round(intensity * 100)}%`}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
