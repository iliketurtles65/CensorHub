import { type ReactNode, useState } from 'react'

interface LayerCardProps {
  title: string
  accent?: 'cyan' | 'pink'
  /** Enabled indicator dot — pink when truthy, subtle otherwise. */
  active?: boolean
  /** Short summary shown in the collapsed header (e.g., "Applied to All (3)"). */
  summary?: string
  defaultOpen?: boolean
  children: ReactNode
}

export function LayerCard({
  title,
  accent = 'cyan',
  active = false,
  summary,
  defaultOpen = false,
  children
}: LayerCardProps) {
  const [open, setOpen] = useState(defaultOpen)
  const accentClass = accent === 'pink' ? 'text-neon-pink' : 'text-neon-cyan'
  const glowClass = accent === 'pink' ? 'text-glow-pink' : 'text-glow-cyan'

  return (
    <div className="bg-bg-secondary border border-border-subtle rounded overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 text-left cursor-pointer hover:bg-bg-primary/20 px-3 py-2"
      >
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
            active ? 'bg-neon-pink shadow-[0_0_6px_#ff0066]' : 'bg-border-subtle'
          }`}
        />
        <span className={`text-[11px] uppercase tracking-[0.2em] ${accentClass} ${glowClass}`}>
          {title}
        </span>
        {summary && (
          <span className="text-[10px] text-text-disabled truncate ml-1">{summary}</span>
        )}
        <span className="ml-auto text-text-secondary text-[10px]">{open ? '▼' : '▶'}</span>
      </button>

      {open && <div className="p-3 pt-2 border-t border-border-subtle/40">{children}</div>}
    </div>
  )
}
