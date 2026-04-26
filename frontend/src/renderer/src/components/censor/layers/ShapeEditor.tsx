import { useCallback, useMemo, useState } from 'react'
import { useStore, LABEL_CATEGORIES, type CensorShape } from '../../../lib/store'
import { useWebSocket } from '../../../hooks/useWebSocket'
import { NeonSlider } from '../../shared/NeonSlider'
import { NeonSelect } from '../../shared/NeonSelect'

const CENSOR_SHAPE_OPTIONS = [
  { value: 'rectangle', label: 'RECTANGLE' },
  { value: 'ellipse', label: 'ELLIPSE' },
  { value: 'rounded_rect', label: 'ROUNDED' }
]

const ALL_ORDERED: string[] = Object.values(LABEL_CATEGORIES).flat()

function formatLabel(label: string): string {
  const parts = label.split('_')
  const genderPrefixes = ['FEMALE', 'MALE']
  const relevant = genderPrefixes.includes(parts[0]) ? parts.slice(1) : parts
  return relevant.map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')
}

export function ShapeEditor() {
  const masterSize = useStore((s) => s.censor.masterSize)
  const masterShape = useStore((s) => s.censor.masterShape)
  const masterFeatherPx = useStore((s) => s.censor.masterFeatherPx)
  const perCategorySize = useStore((s) => s.censor.perCategorySize)
  const enabledSet = useStore((s) => s.censor.enabledClasses)
  const isActive = useStore((s) => s.censor.isActive)
  const setMasterSize = useStore((s) => s.setMasterSize)
  const setMasterShape = useStore((s) => s.setMasterShape)
  const setMasterFeatherPx = useStore((s) => s.setMasterFeatherPx)
  const setCategorySize = useStore((s) => s.setCategorySize)
  const { send } = useWebSocket()
  const [overridesOpen, setOverridesOpen] = useState(false)

  const handleSize = useCallback(
    (value: number) => {
      setMasterSize(value)
      if (isActive) send('censor.settings', { master_size: value })
    },
    [setMasterSize, isActive, send]
  )

  const handleShape = useCallback(
    (value: string) => {
      setMasterShape(value as CensorShape)
      if (isActive) send('censor.settings', { master_shape: value })
    },
    [setMasterShape, isActive, send]
  )

  const handleFeather = useCallback(
    (value: number) => {
      setMasterFeatherPx(value)
      if (isActive) send('censor.settings', { master_feather_px: value })
    },
    [setMasterFeatherPx, isActive, send]
  )

  const handleCategorySize = useCallback(
    (label: string, value: number) => {
      setCategorySize(label, value)
      if (isActive) {
        const next = { ...perCategorySize, [label]: value }
        send('censor.settings', { per_category_size: next })
      }
    },
    [setCategorySize, isActive, perCategorySize, send]
  )

  const clearCategorySize = useCallback(
    (label: string) => {
      setCategorySize(label, null)
      if (isActive) {
        const next = { ...perCategorySize }
        delete next[label]
        send('censor.settings', { per_category_size: next })
      }
    },
    [setCategorySize, isActive, perCategorySize, send]
  )

  const visibleLabels = useMemo(
    () => ALL_ORDERED.filter((l) => enabledSet.has(l)),
    [enabledSet]
  )

  const overrideCount = Object.keys(perCategorySize).length

  return (
    <div className="flex flex-col gap-4">
      <NeonSlider
        label="Size"
        value={masterSize}
        min={0.5}
        max={2.0}
        step={0.05}
        onChange={handleSize}
        displayValue={`${masterSize.toFixed(2)}×`}
      />
      <NeonSelect
        label="Shape"
        value={masterShape}
        options={CENSOR_SHAPE_OPTIONS}
        onChange={handleShape}
      />
      <NeonSlider
        label="Feather"
        value={masterFeatherPx}
        min={0}
        max={32}
        step={1}
        onChange={handleFeather}
        displayValue={`${masterFeatherPx}px`}
      />

      <div className="border-t border-border-subtle/40 pt-2">
        <button
          onClick={() => setOverridesOpen((o) => !o)}
          className="w-full flex items-center justify-between cursor-pointer hover:bg-bg-primary/20 px-1 py-1 rounded"
        >
          <span className="text-[10px] uppercase tracking-wider text-text-secondary">
            {overridesOpen ? '▼' : '▶'} Per-Category Size
            {overrideCount > 0 && (
              <span className="ml-2 text-neon-pink">({overrideCount})</span>
            )}
          </span>
        </button>

        {overridesOpen && (
          <div className="mt-2 flex flex-col gap-2">
            {visibleLabels.length === 0 ? (
              <p className="text-[10px] text-text-disabled py-2 text-center">
                Enable detection classes on the left first.
              </p>
            ) : (
              visibleLabels.map((label) => {
                const override = perCategorySize[label]
                const value = override ?? masterSize
                const hasOverride = override !== undefined
                return (
                  <div key={label} className="flex items-center gap-2">
                    <span className="flex-1 text-[10px] text-text-primary truncate">
                      {formatLabel(label)}
                    </span>
                    <input
                      type="range"
                      min={0.5}
                      max={2.0}
                      step={0.05}
                      value={value}
                      onChange={(e) => handleCategorySize(label, Number(e.target.value))}
                      className="w-24 h-1 appearance-none bg-bg-tertiary rounded-full cursor-pointer
                        [&::-webkit-slider-thumb]:appearance-none
                        [&::-webkit-slider-thumb]:w-3
                        [&::-webkit-slider-thumb]:h-3
                        [&::-webkit-slider-thumb]:rounded-full
                        [&::-webkit-slider-thumb]:bg-neon-pink
                        [&::-webkit-slider-thumb]:cursor-pointer"
                    />
                    <span
                      className={`text-[10px] font-bold tabular-nums w-10 text-right ${
                        hasOverride ? 'text-neon-pink' : 'text-text-disabled'
                      }`}
                    >
                      {value.toFixed(2)}×
                    </span>
                    <button
                      onClick={() => clearCategorySize(label)}
                      disabled={!hasOverride}
                      title="Reset to master size"
                      className={`shrink-0 text-[12px] w-5 h-5 rounded border transition-all ${
                        hasOverride
                          ? 'border-neon-red text-neon-red hover:bg-neon-red/10 cursor-pointer'
                          : 'border-border-subtle text-text-disabled cursor-not-allowed opacity-30'
                      }`}
                    >
                      ↺
                    </button>
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>
    </div>
  )
}
