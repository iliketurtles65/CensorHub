import { useCallback } from 'react'
import { type StrokeLayer, useStore } from '../../../lib/store'
import { useWebSocket } from '../../../hooks/useWebSocket'
import { NeonSlider } from '../../shared/NeonSlider'
import { NeonCheckbox } from '../../shared/NeonCheckbox'
import { ColorPicker } from '../../shared/ColorPicker'

export function StrokeEditor() {
  const layer = useStore((s) => s.censor.masterStroke)
  const isActive = useStore((s) => s.censor.isActive)
  const setMasterStroke = useStore((s) => s.setMasterStroke)
  const { send } = useWebSocket()

  const push = useCallback(
    (next: StrokeLayer) => {
      setMasterStroke(next)
      if (isActive) send('censor.settings', { master_stroke: next })
    },
    [setMasterStroke, isActive, send]
  )

  const update = useCallback((patch: Partial<StrokeLayer>) => push({ ...layer, ...patch }), [layer, push])

  return (
    <div className="flex flex-col gap-3">
      <NeonCheckbox
        label="Enable Stroke"
        checked={layer.enabled}
        onChange={() => update({ enabled: !layer.enabled })}
      />
      <div className={layer.enabled ? '' : 'opacity-40 pointer-events-none'}>
        <div className="mb-3">
          <ColorPicker label="Color" value={layer.color} onChange={(hex) => update({ color: hex })} />
        </div>
        <NeonSlider
          label="Thickness"
          value={layer.thickness}
          min={1}
          max={24}
          step={1}
          onChange={(v) => update({ thickness: v })}
          displayValue={`${layer.thickness}px`}
        />
      </div>
    </div>
  )
}
