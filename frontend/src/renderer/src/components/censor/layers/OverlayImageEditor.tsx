import { useCallback } from 'react'
import {
  type OverlayImageLayer,
  type AssetAssignment,
  ALL_TARGET,
  useStore
} from '../../../lib/store'
import { useWebSocket } from '../../../hooks/useWebSocket'
import { NeonSlider } from '../../shared/NeonSlider'
import { NeonCheckbox } from '../../shared/NeonCheckbox'
import { AssetLibraryPanel } from '../AssetLibraryPanel'
import { AssignmentTargets } from '../AssignmentTargets'

function assetDisplayName(assets: { id: string; filename: string }[], id: string): string {
  return assets.find((a) => a.id === id)?.filename ?? id
}

export function OverlayImageEditor() {
  const layer = useStore((s) => s.censor.masterOverlayImage)
  const assets = useStore((s) => s.censor.imageAssets)
  const isActive = useStore((s) => s.censor.isActive)
  const setMasterOverlayImage = useStore((s) => s.setMasterOverlayImage)
  const { send } = useWebSocket()

  const push = useCallback(
    (next: OverlayImageLayer) => {
      setMasterOverlayImage(next)
      if (isActive) send('censor.settings', { master_overlay_image: next })
    },
    [setMasterOverlayImage, isActive, send]
  )

  const toggle = useCallback(
    (assetId: string) => {
      const already = layer.assignments.find((a) => a.asset_id === assetId)
      if (already) {
        push({ ...layer, assignments: layer.assignments.filter((a) => a.asset_id !== assetId) })
      } else {
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
      <NeonCheckbox
        label="Enable Image Overlay"
        checked={layer.enabled}
        onChange={() => push({ ...layer, enabled: !layer.enabled })}
      />
      <div className={layer.enabled ? 'flex flex-col gap-3' : 'opacity-40 pointer-events-none flex flex-col gap-3'}>
        <NeonSlider
          label="Scale"
          value={layer.scale_pct}
          min={10}
          max={100}
          step={5}
          onChange={(v) => push({ ...layer, scale_pct: v })}
          displayValue={`${layer.scale_pct}%`}
        />
        <NeonSlider
          label="Opacity"
          value={Math.round(layer.opacity * 100)}
          min={0}
          max={100}
          step={5}
          onChange={(v) => push({ ...layer, opacity: v / 100 })}
          displayValue={layer.opacity.toFixed(2)}
        />
        <AssetLibraryPanel
          selectedIds={selectedIds}
          onToggle={toggle}
          maxHeightClass="max-h-40"
        />

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
      </div>
    </div>
  )
}
