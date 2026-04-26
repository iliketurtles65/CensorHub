import { useCallback } from 'react'
import {
  type BaseImageLayer,
  type AssetAssignment,
  type StretchMode,
  ALL_TARGET,
  useStore
} from '../../../lib/store'
import { useWebSocket } from '../../../hooks/useWebSocket'
import { NeonSelect } from '../../shared/NeonSelect'
import { AssetLibraryPanel } from '../AssetLibraryPanel'
import { AssignmentTargets } from '../AssignmentTargets'

const STRETCH_OPTIONS: { value: StretchMode; label: string }[] = [
  { value: 'cover', label: 'COVER (crop to fill)' },
  { value: 'contain', label: 'CONTAIN (fit inside)' },
  { value: 'stretch', label: 'STRETCH (squash)' }
]

function assetDisplayName(assets: { id: string; filename: string }[], id: string): string {
  return assets.find((a) => a.id === id)?.filename ?? id
}

export function BaseImageEditor() {
  const layer = useStore((s) => s.censor.masterBaseImage)
  const assets = useStore((s) => s.censor.imageAssets)
  const isActive = useStore((s) => s.censor.isActive)
  const setMasterBaseImage = useStore((s) => s.setMasterBaseImage)
  const { send } = useWebSocket()

  const push = useCallback(
    (next: BaseImageLayer) => {
      setMasterBaseImage(next)
      if (isActive) send('censor.settings', { master_base_image: next })
    },
    [setMasterBaseImage, isActive, send]
  )

  const toggle = useCallback(
    (assetId: string) => {
      const already = layer.assignments.find((a) => a.asset_id === assetId)
      if (already) {
        push({ ...layer, assignments: layer.assignments.filter((a) => a.asset_id !== assetId) })
      } else {
        // New image defaults to applying to ALL enabled categories.
        push({
          ...layer,
          assignments: [...layer.assignments, { asset_id: assetId, targets: [ALL_TARGET] }]
        })
      }
    },
    [layer, push]
  )

  const setTargets = useCallback(
    (assetId: string, targets: string[]) => {
      push({
        ...layer,
        assignments: layer.assignments.map((a) =>
          a.asset_id === assetId ? { ...a, targets } : a
        )
      })
    },
    [layer, push]
  )

  const selectedIds = layer.assignments.map((a) => a.asset_id)

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[10px] text-text-disabled leading-relaxed">
        Used when the censor type is <span className="text-neon-cyan">IMAGE</span>.
        Each image targets one or more categories.
      </p>
      <NeonSelect
        label="Fit Mode"
        value={layer.stretch}
        options={STRETCH_OPTIONS}
        onChange={(v) => push({ ...layer, stretch: v as StretchMode })}
      />
      <AssetLibraryPanel selectedIds={selectedIds} onToggle={toggle} />

      {layer.assignments.length > 0 && (
        <div className="flex flex-col gap-2 pt-2 border-t border-border-subtle/40">
          <p className="text-[10px] uppercase tracking-wider text-text-secondary">
            Per-image targets
          </p>
          {layer.assignments.map((a: AssetAssignment) => (
            <div key={a.asset_id} className="bg-bg-primary/40 border border-border-subtle/60 rounded p-2 flex flex-col gap-1.5">
              <div className="text-[10px] text-text-primary font-mono truncate">
                {assetDisplayName(assets, a.asset_id)}
              </div>
              <AssignmentTargets
                targets={a.targets}
                onChange={(next) => setTargets(a.asset_id, next)}
              />
            </div>
          ))}
        </div>
      )}

      {layer.assignments.length === 0 && (
        <p className="text-[10px] text-neon-red/80 leading-relaxed">
          No images selected — Image censor will fall back to mosaic until you pick at least one.
        </p>
      )}
    </div>
  )
}
