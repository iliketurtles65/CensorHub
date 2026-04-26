import { useCallback } from 'react'
import {
  type TextLayer,
  type PhraseAssignment,
  ALL_TARGET,
  useStore
} from '../../../lib/store'
import { useWebSocket } from '../../../hooks/useWebSocket'
import { NeonSlider } from '../../shared/NeonSlider'
import { NeonCheckbox } from '../../shared/NeonCheckbox'
import { NeonSelect } from '../../shared/NeonSelect'
import { ColorPicker } from '../../shared/ColorPicker'
import { PhraseLibraryPanel } from '../PhraseLibraryPanel'
import { AssignmentTargets } from '../AssignmentTargets'

function phraseText(phrases: { id: string; text: string }[], id: string): string {
  return phrases.find((p) => p.id === id)?.text ?? id
}

export function TextEditor() {
  const layer = useStore((s) => s.censor.masterText)
  const phrases = useStore((s) => s.censor.phrases)
  const fonts = useStore((s) => s.censor.fonts)
  const isActive = useStore((s) => s.censor.isActive)
  const setMasterText = useStore((s) => s.setMasterText)
  const { send } = useWebSocket()

  const push = useCallback(
    (next: TextLayer) => {
      setMasterText(next)
      if (isActive) send('censor.settings', { master_text: next })
    },
    [setMasterText, isActive, send]
  )

  const update = useCallback(
    (patch: Partial<TextLayer>) => push({ ...layer, ...patch }),
    [layer, push]
  )

  const togglePhrase = useCallback(
    (phraseId: string) => {
      const already = layer.assignments.find((a) => a.phrase_id === phraseId)
      if (already) {
        update({ assignments: layer.assignments.filter((a) => a.phrase_id !== phraseId) })
      } else {
        update({
          assignments: [...layer.assignments, { phrase_id: phraseId, targets: [ALL_TARGET] }]
        })
      }
    },
    [layer, update]
  )

  const setPhraseTargets = useCallback(
    (phraseId: string, targets: string[]) => {
      update({
        assignments: layer.assignments.map((a) =>
          a.phrase_id === phraseId ? { ...a, targets } : a
        )
      })
    },
    [layer, update]
  )

  const selectedIds = layer.assignments.map((a) => a.phrase_id)

  const fontOptions =
    fonts.length > 0
      ? fonts.map((f) => ({
          value: f.id,
          label: f.name + (f.available ? '' : ' (missing)')
        }))
      : [
          { value: 'impact', label: 'Impact' },
          { value: 'arial_bold', label: 'Arial Bold' },
          { value: 'consolas_bold', label: 'Consolas Bold (mono)' },
          { value: 'times_bold', label: 'Times Bold' }
        ]

  return (
    <div className="flex flex-col gap-3">
      <NeonCheckbox
        label="Enable Text"
        checked={layer.enabled}
        onChange={() => update({ enabled: !layer.enabled })}
      />
      <div className={layer.enabled ? 'flex flex-col gap-3' : 'opacity-40 pointer-events-none flex flex-col gap-3'}>
        <NeonSelect
          label="Font"
          value={layer.font_id}
          options={fontOptions}
          onChange={(v) => update({ font_id: v })}
        />

        <ColorPicker label="Text Color" value={layer.color} onChange={(hex) => update({ color: hex })} />

        <NeonSlider
          label="Size"
          value={layer.size_pct}
          min={10}
          max={100}
          step={5}
          onChange={(v) => update({ size_pct: v })}
          displayValue={`${layer.size_pct}%`}
        />

        <div className="border-t border-border-subtle/40 pt-2">
          <NeonCheckbox
            label="Text Outline"
            checked={layer.stroke_enabled}
            onChange={() => update({ stroke_enabled: !layer.stroke_enabled })}
          />
          {layer.stroke_enabled && (
            <div className="mt-2 flex flex-col gap-2">
              <ColorPicker
                label="Outline Color"
                value={layer.stroke_color}
                onChange={(hex) => update({ stroke_color: hex })}
              />
              <NeonSlider
                label="Outline Width"
                value={layer.stroke_px}
                min={0}
                max={8}
                step={1}
                onChange={(v) => update({ stroke_px: v })}
                displayValue={`${layer.stroke_px}px`}
              />
            </div>
          )}
        </div>

        <div className="border-t border-border-subtle/40 pt-2">
          <p className="text-[10px] uppercase tracking-wider text-text-secondary mb-2">Phrases</p>
          <PhraseLibraryPanel selectedIds={selectedIds} onToggle={togglePhrase} />
        </div>

        {layer.assignments.length > 0 && (
          <div className="flex flex-col gap-2 pt-2 border-t border-border-subtle/40">
            <p className="text-[10px] uppercase tracking-wider text-text-secondary">
              Per-phrase targets
            </p>
            {layer.assignments.map((a: PhraseAssignment) => (
              <div key={a.phrase_id} className="bg-bg-primary/40 border border-border-subtle/60 rounded p-2 flex flex-col gap-1.5">
                <div className="text-[10px] text-text-primary font-mono truncate">
                  "{phraseText(phrases, a.phrase_id)}"
                </div>
                <AssignmentTargets
                  targets={a.targets}
                  onChange={(next) => setPhraseTargets(a.phrase_id, next)}
                />
              </div>
            ))}
          </div>
        )}

        {layer.assignments.length === 0 && (
          <p className="text-[10px] text-neon-red/80 leading-relaxed">
            No phrases selected — text won't render until you enable at least one.
          </p>
        )}
      </div>
    </div>
  )
}
