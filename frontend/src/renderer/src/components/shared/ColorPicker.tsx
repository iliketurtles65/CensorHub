import { useCallback } from 'react'

interface ColorPickerProps {
  label?: string
  value: string
  onChange: (hex: string) => void
  className?: string
}

const PRESETS = [
  '#ff0066', '#ff2244', '#ffaa00', '#ffff00',
  '#00ff88', '#00f0ff', '#4466ff', '#aa00ff',
  '#ffffff', '#000000'
]

function normalizeHex(input: string): string | null {
  let s = input.trim()
  if (!s.startsWith('#')) s = '#' + s
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s)) return null
  if (s.length === 4) {
    s = '#' + s.slice(1).split('').map((c) => c + c).join('')
  }
  return s.toLowerCase()
}

export function ColorPicker({ label, value, onChange, className = '' }: ColorPickerProps) {
  const handleText = useCallback(
    (raw: string) => {
      const n = normalizeHex(raw)
      if (n) onChange(n)
    },
    [onChange]
  )

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <span className="text-xs text-text-secondary uppercase tracking-wider">{label}</span>
      )}
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-8 h-8 rounded cursor-pointer bg-transparent border border-border-subtle p-0.5"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => handleText(e.target.value)}
          className="flex-1 bg-bg-primary border border-border-subtle text-text-primary text-xs px-2 py-1.5
            rounded font-mono uppercase
            focus:outline-none focus:border-neon-pink focus:shadow-[0_0_10px_#ff006630]
            transition-all"
          maxLength={7}
        />
      </div>
      <div className="flex gap-1 flex-wrap">
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={`w-5 h-5 rounded-sm border ${
              value.toLowerCase() === p ? 'border-neon-cyan scale-110' : 'border-border-subtle'
            } transition-transform cursor-pointer`}
            style={{ background: p }}
            title={p}
          />
        ))}
      </div>
    </div>
  )
}
