interface PulseIndicatorProps {
  active: boolean
  className?: string
}

export function PulseIndicator({ active, className = '' }: PulseIndicatorProps) {
  return (
    <div
      className={`
        w-2.5 h-2.5 rounded-full pulse-indicator
        ${active ? 'bg-neon-green text-neon-green' : 'bg-neon-red text-neon-red'}
        ${className}
      `}
    />
  )
}
