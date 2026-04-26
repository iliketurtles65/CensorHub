import { useCallback } from 'react'
import { useStore, LABEL_CATEGORIES, ALL_TARGET, type TargetLayer } from '../../lib/store'
import { useWebSocket } from '../../hooks/useWebSocket'

function formatLabel(label: string): string {
  const parts = label.split('_')
  const genderPrefixes = ['FEMALE', 'MALE']
  const relevant = genderPrefixes.includes(parts[0]) ? parts.slice(1) : parts
  return relevant.map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')
}

const WIRE_KEY: Record<TargetLayer, string> = {
  stroke: 'stroke_targets'
}

interface TargetSelectorProps {
  layer: TargetLayer
}

export function TargetSelector({ layer }: TargetSelectorProps) {
  const targets = useStore((s) => s.censor.strokeTargets)
  const enabledSet = useStore((s) => s.censor.enabledClasses)
  const isActive = useStore((s) => s.censor.isActive)
  const setLayerTargets = useStore((s) => s.setLayerTargets)
  const { send } = useWebSocket()

  const allOn = targets.includes(ALL_TARGET)

  const push = useCallback(
    (next: string[]) => {
      setLayerTargets(layer, next)
      if (isActive) {
        send('censor.settings', { [WIRE_KEY[layer]]: next })
      }
    },
    [layer, setLayerTargets, isActive, send]
  )

  const toggleAll = useCallback(() => {
    // ALL button is a true toggle: on → clear to empty; off → wildcard.
    push(allOn ? [] : [ALL_TARGET])
  }, [allOn, push])

  const toggleClass = useCallback(
    (className: string) => {
      if (allOn) {
        // Start explicit from all, then remove this one.
        const expanded = Array.from(enabledSet).filter((c) => c !== className)
        push(expanded)
        return
      }
      const next = targets.includes(className)
        ? targets.filter((c) => c !== className)
        : [...targets, className]
      push(next)
    },
    [allOn, enabledSet, targets, push]
  )

  const anyEnabled = enabledSet.size > 0

  return (
    <div className="flex flex-col gap-2 border-t border-border-subtle/40 pt-2 mt-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-text-secondary">
          Apply to
        </span>
        <button
          onClick={toggleAll}
          className={`text-[10px] px-2 py-0.5 rounded border transition-colors cursor-pointer ${
            allOn
              ? 'border-neon-pink text-neon-pink bg-neon-pink/10'
              : 'border-border-subtle text-text-secondary hover:text-text-primary'
          }`}
        >
          {allOn ? '✓ ALL' : 'ALL'}
        </button>
      </div>

      {!anyEnabled ? (
        <p className="text-[10px] text-text-disabled">
          Enable detection classes on the left to target them here.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {(Object.entries(LABEL_CATEGORIES) as [string, readonly string[]][]).map(
            ([group, labels]) => {
              const visible = labels.filter((l) => enabledSet.has(l))
              if (visible.length === 0) return null
              return (
                <div key={group} className="flex flex-wrap gap-1">
                  {visible.map((label) => {
                    const on = allOn || targets.includes(label)
                    return (
                      <button
                        key={label}
                        onClick={() => toggleClass(label)}
                        className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                          on
                            ? 'border-neon-cyan text-neon-cyan bg-neon-cyan/10'
                            : 'border-border-subtle text-text-secondary hover:text-text-primary'
                        }`}
                        title={label}
                      >
                        {formatLabel(label)}
                      </button>
                    )
                  })}
                </div>
              )
            }
          )}
        </div>
      )}
    </div>
  )
}
