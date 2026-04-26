interface NeonCheckboxProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  className?: string
}

export function NeonCheckbox({ label, checked, onChange, className = '' }: NeonCheckboxProps) {
  return (
    <label
      className={`flex items-center gap-2 cursor-pointer group select-none ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className={`
          w-4 h-4 border rounded-sm flex items-center justify-center transition-all duration-150
          ${
            checked
              ? 'bg-neon-pink/20 border-neon-pink shadow-[0_0_8px_#ff006640]'
              : 'border-border-subtle bg-bg-primary group-hover:border-text-secondary'
          }
        `}
        onClick={() => onChange(!checked)}
      >
        {checked && (
          <svg viewBox="0 0 12 12" className="w-3 h-3 text-neon-pink">
            <path
              d="M2 6l3 3 5-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
      <span
        className={`text-xs transition-colors ${
          checked ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary'
        }`}
        onClick={() => onChange(!checked)}
      >
        {label}
      </span>
    </label>
  )
}
