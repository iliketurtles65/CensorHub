import { useStore } from '../../lib/store'

export function StatusBar() {
  const mode = useStore((s) => s.mode)
  const wsConnected = useStore((s) => s.wsConnected)
  const censor = useStore((s) => s.censor)

  return (
    <div className="h-6 flex items-center justify-between px-3 border-t border-border-subtle bg-bg-secondary/80 text-[10px] shrink-0">
      <div className="flex items-center gap-3">
        <span className="text-text-disabled">
          MODE: <span className="text-text-secondary uppercase">{mode}</span>
        </span>
        {mode === 'censor' && censor.isActive && (
          <>
            <span className="text-text-disabled">
              FPS: <span className="text-neon-green font-bold">{censor.fps.toFixed(0)}</span>
            </span>
            <span className="text-text-disabled">
              DET: <span className="text-neon-cyan font-bold">{censor.detectionCount}</span>
            </span>
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className={wsConnected ? 'text-neon-green' : 'text-neon-red'}>
          {wsConnected ? 'CONNECTED' : 'DISCONNECTED'}
        </span>
      </div>
    </div>
  )
}
