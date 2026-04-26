import { type AppMode, useStore } from '../../lib/store'

const modes: { id: AppMode; label: string; icon: string }[] = [
  { id: 'grid', label: 'GRID', icon: '⊞' },
  { id: 'censor', label: 'CENSOR', icon: '◉' },
  { id: 'hypno', label: 'HYPNO', icon: '◎' }
]

export function Sidebar() {
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  const wsConnected = useStore((s) => s.wsConnected)

  return (
    <div className="flex flex-col w-16 h-full bg-bg-secondary border-r border-border-subtle">
      {/* Logo */}
      <div className="flex items-center justify-center h-9 border-b border-border-subtle titlebar-drag">
        <span className="text-neon-pink font-bold text-xs tracking-widest text-glow-pink">
          C
        </span>
      </div>

      {/* Mode Buttons */}
      <div className="flex flex-col gap-1 p-2 flex-1">
        {modes.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`
              flex flex-col items-center justify-center gap-1 py-3 rounded
              transition-all duration-150 relative
              ${
                mode === m.id
                  ? 'bg-neon-pink/10 text-neon-pink'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
              }
            `}
          >
            {mode === m.id && (
              <div className="absolute left-0 top-1 bottom-1 w-[3px] bg-neon-pink rounded-r glow-pink" />
            )}
            <span className="text-lg leading-none">{m.icon}</span>
            <span className="text-[9px] font-bold tracking-wider">{m.label}</span>
          </button>
        ))}
      </div>

      {/* Bottom: Connection Status */}
      <div className="flex flex-col items-center gap-2 p-2 pb-3">
        <div
          className={`w-2 h-2 rounded-full pulse-indicator ${
            wsConnected ? 'bg-neon-green text-neon-green' : 'bg-neon-red text-neon-red'
          }`}
          title={wsConnected ? 'Backend connected' : 'Backend disconnected'}
        />
      </div>
    </div>
  )
}
