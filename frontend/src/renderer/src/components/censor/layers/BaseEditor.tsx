import { useCallback } from 'react'
import { useStore, type CensorType } from '../../../lib/store'
import { useWebSocket } from '../../../hooks/useWebSocket'
import { NeonSlider } from '../../shared/NeonSlider'
import { NeonSelect } from '../../shared/NeonSelect'

const CENSOR_TYPE_OPTIONS = [
  { value: 'mosaic', label: 'MOSAIC' },
  { value: 'blur', label: 'BLUR' },
  { value: 'black_box', label: 'BLACK BOX' },
  { value: 'pixelation', label: 'PIXELATION' },
  { value: 'image', label: 'IMAGE' }
]

export function BaseEditor() {
  // Granular selectors — isolate from fps/detectionCount churn.
  const type = useStore((s) => s.censor.censorType)
  const intensity = useStore((s) => s.censor.intensity)
  const confidence = useStore((s) => s.censor.confidenceThreshold)
  const isActive = useStore((s) => s.censor.isActive)
  const setCensorType = useStore((s) => s.setCensorType)
  const setIntensity = useStore((s) => s.setIntensity)
  const setConfidenceThreshold = useStore((s) => s.setConfidenceThreshold)
  const { send } = useWebSocket()

  const handleType = useCallback(
    (value: string) => {
      setCensorType(value as CensorType)
      if (isActive) send('censor.settings', { censor_type: value })
    },
    [setCensorType, isActive, send]
  )

  const handleIntensity = useCallback(
    (value: number) => {
      setIntensity(value)
      if (isActive) send('censor.settings', { intensity: value })
    },
    [setIntensity, isActive, send]
  )

  const handleConfidence = useCallback(
    (value: number) => {
      setConfidenceThreshold(value)
      if (isActive) send('censor.settings', { confidence_threshold: value })
    },
    [setConfidenceThreshold, isActive, send]
  )

  return (
    <div className="flex flex-col gap-4">
      <NeonSelect
        label="Censor Type"
        value={type}
        options={CENSOR_TYPE_OPTIONS}
        onChange={handleType}
      />
      <NeonSlider
        label="Intensity"
        value={intensity}
        onChange={handleIntensity}
        displayValue={`${intensity}%`}
      />
      <NeonSlider
        label="Confidence"
        value={confidence}
        min={0}
        max={1}
        step={0.05}
        onChange={handleConfidence}
        displayValue={confidence.toFixed(2)}
      />
    </div>
  )
}
