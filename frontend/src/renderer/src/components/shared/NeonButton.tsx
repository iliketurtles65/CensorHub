import { type ReactNode } from 'react'

interface NeonButtonProps {
  children: ReactNode
  onClick?: () => void
  variant?: 'pink' | 'cyan' | 'red' | 'green'
  size?: 'sm' | 'md' | 'lg'
  active?: boolean
  disabled?: boolean
  className?: string
}

const variantStyles = {
  pink: {
    base: 'border-neon-pink text-neon-pink',
    hover: 'hover:bg-neon-pink/10 hover:shadow-[0_0_15px_#ff006640]',
    active: 'bg-neon-pink/15 shadow-[0_0_20px_#ff006650]'
  },
  cyan: {
    base: 'border-neon-cyan text-neon-cyan',
    hover: 'hover:bg-neon-cyan/10 hover:shadow-[0_0_15px_#00f0ff40]',
    active: 'bg-neon-cyan/15 shadow-[0_0_20px_#00f0ff50]'
  },
  red: {
    base: 'border-neon-red text-neon-red',
    hover: 'hover:bg-neon-red/10 hover:shadow-[0_0_15px_#ff224440]',
    active: 'bg-neon-red/15 shadow-[0_0_20px_#ff224450]'
  },
  green: {
    base: 'border-neon-green text-neon-green',
    hover: 'hover:bg-neon-green/10 hover:shadow-[0_0_15px_#00ff8840]',
    active: 'bg-neon-green/15 shadow-[0_0_20px_#00ff8850]'
  }
}

const sizeStyles = {
  sm: 'px-3 py-1.5 text-[10px]',
  md: 'px-4 py-2 text-xs',
  lg: 'px-6 py-3 text-sm'
}

export function NeonButton({
  children,
  onClick,
  variant = 'pink',
  size = 'md',
  active = false,
  disabled = false,
  className = ''
}: NeonButtonProps) {
  const v = variantStyles[variant]

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        bg-bg-tertiary border font-mono uppercase tracking-wider
        transition-all duration-150 cursor-pointer
        ${v.base} ${v.hover}
        ${active ? v.active : ''}
        ${sizeStyles[size]}
        ${disabled ? 'opacity-40 cursor-not-allowed' : ''}
        ${className}
      `}
    >
      {children}
    </button>
  )
}
