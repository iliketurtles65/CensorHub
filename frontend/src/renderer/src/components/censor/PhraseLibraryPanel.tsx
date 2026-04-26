import { useCallback, useState } from 'react'
import { useStore, type Phrase } from '../../lib/store'
import { useWebSocket } from '../../hooks/useWebSocket'

function genId(): string {
  // Compact-ish unique id; server doesn't validate the shape.
  return 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

interface PhraseLibraryPanelProps {
  selectedIds: string[]
  onToggle: (phraseId: string) => void
  maxHeightClass?: string
}

export function PhraseLibraryPanel({
  selectedIds,
  onToggle,
  maxHeightClass = 'max-h-40'
}: PhraseLibraryPanelProps) {
  const phrases = useStore((s) => s.censor.phrases)
  const { send } = useWebSocket()
  const [draft, setDraft] = useState('')

  const pushPhrases = useCallback(
    (next: Phrase[]) => {
      send('phrases.update', { phrases: next })
    },
    [send]
  )

  const addPhrase = useCallback(() => {
    const text = draft.trim()
    if (!text) return
    const p: Phrase = { id: genId(), text }
    pushPhrases([...phrases, p])
    setDraft('')
  }, [draft, phrases, pushPhrases])

  const removePhrase = useCallback(
    (id: string) => {
      pushPhrases(phrases.filter((p) => p.id !== id))
    },
    [phrases, pushPhrases]
  )

  const editPhrase = useCallback(
    (id: string, text: string) => {
      pushPhrases(phrases.map((p) => (p.id === id ? { ...p, text } : p)))
    },
    [phrases, pushPhrases]
  )

  const selected = new Set(selectedIds)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addPhrase()
          }}
          placeholder="Add phrase..."
          className="flex-1 bg-bg-primary border border-border-subtle text-text-primary text-xs px-2 py-1.5
            rounded font-mono
            focus:outline-none focus:border-neon-pink focus:shadow-[0_0_10px_#ff006630]
            transition-all"
        />
        <button
          onClick={addPhrase}
          disabled={!draft.trim()}
          className="text-[10px] px-2 py-1.5 rounded border border-neon-cyan text-neon-cyan
            hover:bg-neon-cyan/10 cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ADD
        </button>
      </div>

      {phrases.length === 0 ? (
        <p className="text-[10px] text-text-disabled py-3 text-center border border-dashed border-border-subtle rounded">
          No phrases yet. Type one above and press Enter.
        </p>
      ) : (
        <div className={`flex flex-col gap-1 overflow-y-auto ${maxHeightClass}`}>
          {phrases.map((p) => {
            const on = selected.has(p.id)
            return (
              <div
                key={p.id}
                className={`flex items-center gap-2 px-2 py-1 rounded border transition-colors ${
                  on ? 'border-neon-pink bg-neon-pink/5' : 'border-border-subtle'
                }`}
              >
                <button
                  onClick={() => onToggle(p.id)}
                  className={`shrink-0 w-4 h-4 rounded border text-[10px] font-bold flex items-center justify-center ${
                    on
                      ? 'bg-neon-pink border-neon-pink text-bg-primary'
                      : 'border-border-subtle text-transparent hover:border-neon-pink'
                  } cursor-pointer`}
                >
                  ✓
                </button>
                <input
                  type="text"
                  value={p.text}
                  onChange={(e) => editPhrase(p.id, e.target.value)}
                  className="flex-1 bg-transparent text-xs text-text-primary font-mono px-1 py-0.5
                    border border-transparent hover:border-border-subtle focus:border-neon-cyan
                    rounded focus:outline-none transition-colors"
                />
                <button
                  onClick={() => removePhrase(p.id)}
                  className="shrink-0 w-4 h-4 rounded bg-neon-red/80 text-[10px] text-white opacity-60 hover:opacity-100 cursor-pointer"
                  title="Remove phrase"
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
