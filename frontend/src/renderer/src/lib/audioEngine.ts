/**
 * Web Audio API-based DSP engine for real-time audio effects.
 *
 * Graph (stable edges `═`, rewireable edges `─`):
 *
 *   source₁ ══► sourceGain₁ ─┐
 *   source₂ ══► sourceGain₂ ─┼── chainHead ─► effect₂ ─► ... ─► masterGain ══► destination
 *   source₃ ══► sourceGain₃ ─┘
 *
 * The edge from each `MediaElementAudioSourceNode` to its dedicated
 * `sourceGain` is wired exactly once per element and is NEVER disconnected.
 * Only `sourceGain → chainHead` and effect-to-effect edges are rewired.
 *
 * This matters because:
 *   1. `createMediaElementSource(el)` may be called at most once per element,
 *      so we track sources in a WeakMap (keyed by element) and never recreate.
 *   2. Disconnecting a `MediaElementAudioSourceNode` and later reconnecting it
 *      has quirky behavior in Chromium (especially when the element's `src`
 *      changes mid-stream). Keeping that edge permanent sidesteps the quirk
 *      entirely — rewiring happens on plain `GainNode`s, which are well-behaved.
 */

interface EffectNode {
  input: AudioNode
  output: AudioNode
  /** Called with a 0..1 normalized intensity. */
  setIntensity?: (value: number) => void
  dispose: () => void
}

interface SourceRec {
  source: MediaElementAudioSourceNode
  gain: GainNode
}

export class AudioEngine {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private effects: Map<string, EffectNode> = new Map()
  private effectOrder: string[] = []
  private intensityByName: Map<string, number> = new Map()
  private recordByEl: WeakMap<HTMLMediaElement, SourceRec> = new WeakMap()
  private allRecords: Set<SourceRec> = new Set()

  init(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.masterGain = this.ctx.createGain()
      this.masterGain.gain.value = 1.0
      this.masterGain.connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {})
    }
    return this.ctx
  }

  /**
   * Idempotent per element. Creates a source + dedicated sourceGain on first
   * call; on subsequent calls just ensures the gain is wired to the current
   * chain head (StrictMode-safe).
   */
  connectMediaElement(el: HTMLMediaElement): void {
    if (!this.ctx) this.init()

    let rec = this.recordByEl.get(el)
    if (!rec) {
      try {
        const source = this.ctx!.createMediaElementSource(el)
        const gain = this.ctx!.createGain()
        gain.gain.value = 1.0
        source.connect(gain)
        rec = { source, gain }
        this.recordByEl.set(el, rec)
      } catch (e) {
        console.warn('[AudioEngine] createMediaElementSource failed:', e)
        return
      }
    }

    this.allRecords.add(rec)
    // Rewire the gain → chainHead edge unconditionally. Cheap and guarantees
    // correct routing even if a prior rebuild left it disconnected.
    try { rec.gain.disconnect() } catch {}
    try { rec.gain.connect(this._chainHead()) } catch (e) {
      console.warn('[AudioEngine] gain→chainHead connect failed:', e)
    }
  }

  /**
   * No-op. The source↔element binding is permanent, and the source→gain edge
   * is kept alive so the element can keep streaming (we might get re-mounted
   * via React StrictMode). The WeakMap clears automatically on element GC.
   */
  disconnectMediaElement(_el: HTMLMediaElement): void {
    // intentionally blank
  }

  setEffects(effectNames: string[]): void {
    try {
      if (!this.ctx) this.init()

      const same =
        effectNames.length === this.effectOrder.length &&
        effectNames.every((n, i) => n === this.effectOrder[i])
      if (same) return

      for (const [name, node] of this.effects) {
        if (!effectNames.includes(name)) {
          try { node.dispose() } catch {}
          this.effects.delete(name)
        }
      }

      for (const name of effectNames) {
        if (!this.effects.has(name)) {
          const node = this._createEffect(name)
          if (node) {
            this.effects.set(name, node)
            const stored = this.intensityByName.get(name)
            if (stored !== undefined && node.setIntensity) node.setIntensity(stored)
          }
        }
      }

      this.effectOrder = [...effectNames]
      this._rebuildChain()
    } catch (e) {
      console.warn('[AudioEngine] Error setting effects:', e)
    }
  }

  setEffectIntensity(name: string, value: number): void {
    const v = Math.max(0, Math.min(1, value))
    this.intensityByName.set(name, v)
    const eff = this.effects.get(name)
    if (eff?.setIntensity) eff.setIntensity(v)
  }

  setMasterVolume(volume: number): void {
    if (!this.masterGain || !this.ctx) return
    const v = Math.max(0, Math.min(1, volume))
    this.masterGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03)
  }

  dispose(): void {
    for (const [, node] of this.effects) { try { node.dispose() } catch {} }
    this.effects.clear()
    this.effectOrder = []
    this.allRecords.clear()
    this.intensityByName.clear()
    this.masterGain = null
    this.ctx?.close().catch(() => {})
    this.ctx = null
  }

  private _chainHead(): AudioNode {
    if (!this.masterGain) this.init()
    const firstName = this.effectOrder.find((n) => this.effects.has(n))
    if (firstName) return this.effects.get(firstName)!.input
    return this.masterGain!
  }

  /** Rewires `sourceGain → chain → masterGain`. Sources themselves are untouched. */
  private _rebuildChain(): void {
    if (!this.ctx || !this.masterGain) return
    try {
      for (const rec of this.allRecords) {
        try { rec.gain.disconnect() } catch {}
      }
      for (const node of this.effects.values()) {
        try { node.output.disconnect() } catch {}
      }

      const list: EffectNode[] = []
      for (const name of this.effectOrder) {
        const n = this.effects.get(name)
        if (n) list.push(n)
      }

      for (let i = 0; i < list.length; i++) {
        const target = i < list.length - 1 ? list[i + 1].input : this.masterGain
        list[i].output.connect(target)
      }

      const head = this._chainHead()
      for (const rec of this.allRecords) {
        try { rec.gain.connect(head) } catch {}
      }
    } catch (e) {
      console.warn('[AudioEngine] Error rebuilding chain:', e)
    }
  }

  private _createEffect(name: string): EffectNode | null {
    if (!this.ctx) return null
    const ctx = this.ctx
    const smooth = 0.02

    switch (name) {
      case 'Reverb':
      case 'Heavy Reverb': {
        const input = ctx.createGain()
        const dry = ctx.createGain()
        const wet = ctx.createGain()
        const convolver = ctx.createConvolver()
        const output = ctx.createGain()
        const duration = name === 'Heavy Reverb' ? 4.0 : 2.0
        convolver.buffer = createReverbImpulse(ctx, duration, 2.0)

        input.connect(dry)
        input.connect(convolver)
        convolver.connect(wet)
        dry.connect(output)
        wet.connect(output)

        const setIntensity = (v: number) => {
          const t = ctx.currentTime
          dry.gain.setTargetAtTime(1.0 - v * 0.5, t, smooth)
          wet.gain.setTargetAtTime(v * 1.2, t, smooth)
        }
        setIntensity(0.5)

        return {
          input,
          output,
          setIntensity,
          dispose: () => {
            input.disconnect(); dry.disconnect(); wet.disconnect()
            convolver.disconnect(); output.disconnect()
          }
        }
      }

      case 'Echo': {
        const input = ctx.createGain()
        const delay = ctx.createDelay(2.0)
        delay.delayTime.value = 0.3
        const feedback = ctx.createGain()
        const wet = ctx.createGain()
        const output = ctx.createGain()

        input.connect(output)
        input.connect(delay)
        delay.connect(feedback)
        feedback.connect(delay)
        delay.connect(wet)
        wet.connect(output)

        const setIntensity = (v: number) => {
          const t = ctx.currentTime
          wet.gain.setTargetAtTime(v * 0.9, t, smooth)
          feedback.gain.setTargetAtTime(v * 0.65, t, smooth)
        }
        setIntensity(0.5)

        return {
          input,
          output,
          setIntensity,
          dispose: () => {
            input.disconnect(); delay.disconnect(); feedback.disconnect()
            wet.disconnect(); output.disconnect()
          }
        }
      }

      case 'Low-Pass Filter': {
        const filter = ctx.createBiquadFilter()
        filter.type = 'lowpass'
        filter.Q.value = 1.0

        const setIntensity = (v: number) => {
          const cutoff = 18000 * Math.pow(200 / 18000, v)
          filter.frequency.setTargetAtTime(cutoff, ctx.currentTime, smooth)
        }
        setIntensity(0.5)

        return { input: filter, output: filter, setIntensity, dispose: () => filter.disconnect() }
      }

      case 'High-Pass Filter': {
        const filter = ctx.createBiquadFilter()
        filter.type = 'highpass'
        filter.Q.value = 1.0

        const setIntensity = (v: number) => {
          const cutoff = 40 * Math.pow(6000 / 40, v)
          filter.frequency.setTargetAtTime(cutoff, ctx.currentTime, smooth)
        }
        setIntensity(0.5)

        return { input: filter, output: filter, setIntensity, dispose: () => filter.disconnect() }
      }

      case 'Distortion': {
        const input = ctx.createGain()
        const shaper = ctx.createWaveShaper()
        shaper.curve = makeDistortionCurve(400) as any
        shaper.oversample = '4x'
        const dry = ctx.createGain()
        const wet = ctx.createGain()
        const output = ctx.createGain()

        input.connect(dry)
        input.connect(shaper)
        shaper.connect(wet)
        dry.connect(output)
        wet.connect(output)

        const setIntensity = (v: number) => {
          const t = ctx.currentTime
          dry.gain.setTargetAtTime(1.0 - v * 0.5, t, smooth)
          wet.gain.setTargetAtTime(v * 0.8, t, smooth)
        }
        setIntensity(0.5)

        return {
          input,
          output,
          setIntensity,
          dispose: () => {
            input.disconnect(); shaper.disconnect(); dry.disconnect()
            wet.disconnect(); output.disconnect()
          }
        }
      }

      case 'Chorus': {
        const input = ctx.createGain()
        const dry = ctx.createGain()
        const wet = ctx.createGain()
        const delay = ctx.createDelay(0.1)
        delay.delayTime.value = 0.025
        const lfo = ctx.createOscillator()
        const lfoGain = ctx.createGain()
        lfo.frequency.value = 1.5
        lfo.connect(lfoGain)
        lfoGain.connect(delay.delayTime)
        lfo.start()

        const output = ctx.createGain()
        input.connect(dry)
        input.connect(delay)
        delay.connect(wet)
        dry.connect(output)
        wet.connect(output)

        const setIntensity = (v: number) => {
          const t = ctx.currentTime
          dry.gain.setTargetAtTime(1.0 - v * 0.4, t, smooth)
          wet.gain.setTargetAtTime(v * 0.9, t, smooth)
          lfoGain.gain.setTargetAtTime(v * 0.015, t, smooth)
        }
        setIntensity(0.5)

        return {
          input,
          output,
          setIntensity,
          dispose: () => {
            try { lfo.stop() } catch {}
            lfo.disconnect(); lfoGain.disconnect()
            input.disconnect(); dry.disconnect(); wet.disconnect()
            delay.disconnect(); output.disconnect()
          }
        }
      }

      case 'Bitcrusher': {
        const bufferSize = 4096
        const proc = ctx.createScriptProcessor(bufferSize, 2, 2)
        let bits = 4
        let normFreq = 0.15
        let step = Math.pow(0.5, bits)
        let phaser = 0
        let lastL = 0
        let lastR = 0
        proc.onaudioprocess = (e) => {
          const inBuf = e.inputBuffer
          const outBuf = e.outputBuffer
          const chL = inBuf.getChannelData(0)
          const chR = inBuf.numberOfChannels > 1 ? inBuf.getChannelData(1) : chL
          const oL = outBuf.getChannelData(0)
          const oR = outBuf.getChannelData(1)
          const len = chL.length
          for (let i = 0; i < len; i++) {
            phaser += normFreq
            if (phaser >= 1.0) {
              phaser -= 1.0
              lastL = step * Math.floor(chL[i] / step + 0.5)
              lastR = step * Math.floor(chR[i] / step + 0.5)
            }
            oL[i] = lastL
            oR[i] = lastR
          }
        }

        const setIntensity = (v: number) => {
          bits = Math.max(2, Math.round(12 - v * 10))
          step = Math.pow(0.5, bits)
          normFreq = 0.5 - v * 0.42
        }
        setIntensity(0.5)

        return {
          input: proc,
          output: proc,
          setIntensity,
          dispose: () => {
            proc.onaudioprocess = null as any
            try { proc.disconnect() } catch {}
          }
        }
      }

      case 'Compressor': {
        const comp = ctx.createDynamicsCompressor()
        comp.knee.value = 30
        comp.attack.value = 0.003
        comp.release.value = 0.25

        const setIntensity = (v: number) => {
          const t = ctx.currentTime
          comp.threshold.setTargetAtTime(-6 - v * 38, t, smooth)
          comp.ratio.setTargetAtTime(2 + v * 16, t, smooth)
        }
        setIntensity(0.5)

        return { input: comp, output: comp, setIntensity, dispose: () => comp.disconnect() }
      }

      case 'Stereo Pan':
      case 'Auto-pan': {
        const panner = ctx.createStereoPanner()
        const lfo = ctx.createOscillator()
        const lfoGain = ctx.createGain()
        lfo.frequency.value = name === 'Auto-pan' ? 0.2 : 0.5
        lfo.connect(lfoGain)
        lfoGain.connect(panner.pan)
        lfo.start()

        const setIntensity = (v: number) => {
          lfoGain.gain.setTargetAtTime(v, ctx.currentTime, smooth)
        }
        setIntensity(0.5)

        return {
          input: panner,
          output: panner,
          setIntensity,
          dispose: () => {
            try { lfo.stop() } catch {}
            lfo.disconnect(); lfoGain.disconnect(); panner.disconnect()
          }
        }
      }

      case 'Binaural Beats': {
        const gain = ctx.createGain()
        gain.gain.value = 0.15

        const oscL = ctx.createOscillator()
        const oscR = ctx.createOscillator()
        oscL.frequency.value = 200
        oscR.frequency.value = 210

        const merger = ctx.createChannelMerger(2)
        oscL.connect(merger, 0, 0)
        oscR.connect(merger, 0, 1)
        merger.connect(gain)
        oscL.start()
        oscR.start()

        const input = ctx.createGain()
        const output = ctx.createGain()
        input.connect(output)
        gain.connect(output)

        const setIntensity = (v: number) => {
          gain.gain.setTargetAtTime(v * 0.35, ctx.currentTime, smooth)
        }
        setIntensity(0.5)

        return {
          input,
          output,
          setIntensity,
          dispose: () => {
            try { oscL.stop(); oscR.stop() } catch {}
            oscL.disconnect(); oscR.disconnect(); merger.disconnect()
            gain.disconnect(); input.disconnect(); output.disconnect()
          }
        }
      }

      case 'Sub-bass Drone': {
        const osc = ctx.createOscillator()
        osc.frequency.value = 45
        osc.type = 'sine'
        const gain = ctx.createGain()
        gain.gain.value = 0.1
        osc.connect(gain)
        osc.start()

        const input = ctx.createGain()
        const output = ctx.createGain()
        input.connect(output)
        gain.connect(output)

        const setIntensity = (v: number) => {
          gain.gain.setTargetAtTime(v * 0.25, ctx.currentTime, smooth)
        }
        setIntensity(0.5)

        return {
          input,
          output,
          setIntensity,
          dispose: () => {
            try { osc.stop() } catch {}
            osc.disconnect(); gain.disconnect()
            input.disconnect(); output.disconnect()
          }
        }
      }

      default:
        return null
    }
  }
}

function createReverbImpulse(ctx: AudioContext, duration: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate
  const length = rate * duration
  const buffer = ctx.createBuffer(2, length, rate)
  const l = buffer.getChannelData(0)
  const r = buffer.getChannelData(1)

  for (let i = 0; i < length; i++) {
    const t = i / length
    const env = Math.pow(1 - t, decay)
    l[i] = (Math.random() * 2 - 1) * env
    r[i] = (Math.random() * 2 - 1) * env
  }

  return buffer
}

function makeDistortionCurve(amount: number): Float32Array {
  const samples = 44100
  const curve = new Float32Array(samples)
  const deg = Math.PI / 180

  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1
    curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x))
  }

  return curve
}

export const audioEngine = new AudioEngine()
