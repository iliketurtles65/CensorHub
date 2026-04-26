interface NeonSelectProps {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  className?: string
}

export function NeonSelect({ label, value, options, onChange, className = '' }: NeonSelectProps) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <span className="text-xs text-text-secondary uppercase tracking-wider">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-bg-primary border border-border-subtle text-text-primary text-xs px-3 py-2
          rounded cursor-pointer font-mono
          focus:outline-none focus:border-neon-pink focus:shadow-[0_0_10px_#ff006630]
          transition-all"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}
