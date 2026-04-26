import { useEffect, useMemo, useRef } from 'react'
import { audioEngine } from '../lib/audioEngine'

/**
 * Hook to manage audio DSP effects on media elements.
 *
 * The returned handle is memoized — its identity is stable across renders so
 * that consumers passing `connectElement` to child components don't cause
 * ref-passing effects to re-fire on every parent re-render. (Re-firing would
 * otherwise trigger disconnect/reconnect cycles that break Web Audio, since
 * `createMediaElementSource` can only be called once per HTMLMediaElement.)
 */
export function useAudioDSP(
  effects: string[],
  intensities: Record<string, number> = {}
) {
  const prevEffects = useRef<string[]>([])

  useEffect(() => {
    if (
      effects.length !== prevEffects.current.length ||
      effects.some((e, i) => e !== prevEffects.current[i])
    ) {
      audioEngine.init()
      audioEngine.setEffects(effects)
      prevEffects.current = effects
    }
  }, [effects])

  useEffect(() => {
    for (const name of effects) {
      const v = intensities[name]
      if (typeof v === 'number') audioEngine.setEffectIntensity(name, v)
    }
  }, [effects, intensities])

  return useMemo(
    () => ({
      connectElement: (el: HTMLMediaElement) => {
        audioEngine.init()
        audioEngine.connectMediaElement(el)
      },
      disconnectElement: (el: HTMLMediaElement) => {
        audioEngine.disconnectMediaElement(el)
      },
      setVolume: (volume: number) => {
        audioEngine.setMasterVolume(volume)
      }
    }),
    []
  )
}
