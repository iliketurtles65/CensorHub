interface NeonSliderProps {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
  displayValue?: string
  className?: string
}

export function NeonSlider({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  displayValue,
  className = ''
}: NeonSliderProps) {
  const pct = ((value - min) / (max - min)) * 100

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-secondary uppercase tracking-wider">{label}</span>
        <span className="text-xs text-neon-pink font-bold tabular-nums">
          {displayValue ?? value}
        </span>
      </div>
      <div className="relative h-6 flex items-center">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full h-1.5 appearance-none bg-bg-tertiary rounded-full cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-3.5
            [&::-webkit-slider-thumb]:h-3.5
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-neon-pink
            [&::-webkit-slider-thumb]:shadow-[0_0_8px_#ff006680]
            [&::-webkit-slider-thumb]:cursor-pointer
            [&::-webkit-slider-thumb]:transition-shadow
            [&::-webkit-slider-thumb]:hover:shadow-[0_0_14px_#ff006690]"
          style={{
            background: `linear-gradient(to right, #ff0066 0%, #ff0066 ${pct}%, #1a1a2e ${pct}%, #1a1a2e 100%)`
          }}
        />
      </div>
    </div>
  )
}
