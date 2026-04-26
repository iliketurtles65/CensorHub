import { useCallback } from 'react'
import { useStore, LABEL_CATEGORIES, ALL_TARGET } from '../../lib/store'

function formatLabel(label: string): string {
  const parts = label.split('_')
  const genderPrefixes = ['FEMALE', 'MALE']
  const relevant = genderPrefixes.includes(parts[0]) ? parts.slice(1) : parts
  return relevant.map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')
}

interface AssignmentTargetsProps {
  targets: string[]
  onChange: (next: string[]) => void
}

/**
 * Compact per-assignment target picker:
 *   [ ALL ]  [ Face F. ]  [ Breast E. ]  [ Buttocks E. ]  …
 *
 * ALL chip toggles the wildcard. When ALL is on, individual chips render as
 * visually active but locked. Clicking an individual chip while ALL is on
 * expands to the full explicit list minus that class.
 */
export function AssignmentTargets({ targets, onChange }: AssignmentTargetsProps) {
  const enabledSet = useStore((s) => s.censor.enabledClasses)
  const allOn = targets.includes(ALL_TARGET)

  const toggleAll = useCallback(() => {
    // ALL button is a true toggle: on → everything off; off → wildcard on.
    onChange(allOn ? [] : [ALL_TARGET])
  }, [allOn, onChange])

  const toggleClass = useCallback(
    (className: string) => {
      if (allOn) {
        onChange(Array.from(enabledSet).filter((c) => c !== className))
        return
      }
      const next = targets.includes(className)
        ? targets.filter((c) => c !== className)
        : [...targets, className]
      onChange(next)
    },
    [allOn, enabledSet, targets, onChange]
  )

  if (enabledSet.size === 0) {
    return (
      <p className="text-[10px] text-text-disabled mt-1">
        Enable detection classes on the left to target them here.
      </p>
    )
  }

  return (
    <div className="flex flex-wrap gap-1 items-center">
      <button
        onClick={toggleAll}
        className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
          allOn
            ? 'border-neon-pink text-neon-pink bg-neon-pink/10'
            : 'border-border-subtle text-text-secondary hover:text-text-primary'
        }`}
      >
        {allOn ? '✓ ALL' : 'ALL'}
      </button>
      {(Object.entries(LABEL_CATEGORIES) as [string, readonly string[]][]).flatMap(
        ([, labels]) =>
          labels
            .filter((l) => enabledSet.has(l))
            .map((label) => {
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
            })
      )}
    </div>
  )
}
