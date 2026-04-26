import { useCallback } from 'react'
import { useStore, LABEL_CATEGORIES } from '../../lib/store'
import { useWebSocket } from '../../hooks/useWebSocket'
import { NeonCheckbox } from '../shared/NeonCheckbox'

function formatLabel(label: string): string {
  // "FEMALE_BREAST_EXPOSED" → "Breast Exposed"
  // "BUTTOCKS_EXPOSED" → "Buttocks Exposed" (no gender prefix to strip)
  const parts = label.split('_')
  const genderPrefixes = ['FEMALE', 'MALE']
  const relevant = genderPrefixes.includes(parts[0]) ? parts.slice(1) : parts
  return relevant.map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')
}

interface CategoryGroupProps {
  title: string
  labels: readonly string[]
}

function CategoryGroup({ title, labels }: CategoryGroupProps) {
  const enabledClasses = useStore((s) => s.censor.enabledClasses)
  const toggleClass = useStore((s) => s.toggleClass)
  const isActive = useStore((s) => s.censor.isActive)
  const { send } = useWebSocket()

  const handleToggle = useCallback(
    (label: string) => {
      toggleClass(label)
      // We need to sync after toggle — get the updated state
      if (isActive) {
        const newClasses = new Set(enabledClasses)
        if (newClasses.has(label)) newClasses.delete(label)
        else newClasses.add(label)
        send('censor.settings', { enabled_classes: Array.from(newClasses) })
      }
    },
    [toggleClass, isActive, enabledClasses, send]
  )

  return (
    <div className="bg-bg-secondary border border-border-subtle rounded p-3">
      <h3 className="text-[10px] text-neon-cyan uppercase tracking-[0.2em] mb-2 text-glow-cyan">
        {title}
      </h3>
      <div className="flex flex-col gap-1.5">
        {labels.map((label) => (
          <NeonCheckbox
            key={label}
            label={formatLabel(label)}
            checked={enabledClasses.has(label)}
            onChange={() => handleToggle(label)}
          />
        ))}
      </div>
    </div>
  )
}

export function DetectionClassPanel() {
  return (
    <div className="flex flex-col gap-3">
      {Object.entries(LABEL_CATEGORIES).map(([category, labels]) => (
        <CategoryGroup key={category} title={category} labels={labels} />
      ))}
    </div>
  )
}
