/**
 * Zustand store for application state.
 */
import { create } from 'zustand'

export type AppMode = 'censor' | 'grid' | 'hypno'
export type CensorType = 'mosaic' | 'blur' | 'black_box' | 'pixelation' | 'image'
export type CensorShape = 'rectangle' | 'ellipse' | 'rounded_rect'
export type StretchMode = 'cover' | 'contain' | 'stretch'

export interface StrokeLayer {
  enabled: boolean
  color: string
  thickness: number
}

export const DEFAULT_STROKE: StrokeLayer = {
  enabled: false,
  color: '#ff0066',
  thickness: 2
}

export interface AssetAssignment {
  asset_id: string
  targets: string[]
}

export interface PhraseAssignment {
  phrase_id: string
  targets: string[]
}

export interface BaseImageLayer {
  assignments: AssetAssignment[]
  stretch: StretchMode
}

export const DEFAULT_BASE_IMAGE: BaseImageLayer = {
  assignments: [],
  stretch: 'cover'
}

export interface OverlayImageLayer {
  enabled: boolean
  assignments: AssetAssignment[]
  scale_pct: number
  opacity: number
}

export const DEFAULT_OVERLAY_IMAGE: OverlayImageLayer = {
  enabled: false,
  assignments: [],
  scale_pct: 80,
  opacity: 1.0
}

export interface TextLayer {
  enabled: boolean
  assignments: PhraseAssignment[]
  font_id: string
  color: string
  size_pct: number
  stroke_enabled: boolean
  stroke_color: string
  stroke_px: number
}

export const DEFAULT_TEXT: TextLayer = {
  enabled: false,
  assignments: [],
  font_id: 'impact',
  color: '#ffffff',
  size_pct: 40,
  stroke_enabled: true,
  stroke_color: '#000000',
  stroke_px: 2
}

export interface Phrase {
  id: string
  text: string
}

export interface FontInfo {
  id: string
  name: string
  available: boolean
}

export interface ImageAsset {
  id: string
  filename: string
  path: string
  w: number
  h: number
}

// stroke is the only layer that keeps a single layer-level target list.
// Overlay / text / base now use per-assignment targets on each item.
export type TargetLayer = 'stroke'

export const ALL_TARGET = '*'
export const DEFAULT_TARGETS = [ALL_TARGET]

export const ALL_LABELS = [
  'FEMALE_GENITALIA_COVERED',
  'FACE_FEMALE',
  'BUTTOCKS_EXPOSED',
  'FEMALE_BREAST_EXPOSED',
  'FEMALE_GENITALIA_EXPOSED',
  'MALE_BREAST_EXPOSED',
  'ANUS_EXPOSED',
  'FEET_EXPOSED',
  'BELLY_COVERED',
  'FEET_COVERED',
  'ARMPITS_COVERED',
  'ARMPITS_EXPOSED',
  'FACE_MALE',
  'BELLY_EXPOSED',
  'MALE_GENITALIA_EXPOSED',
  'ANUS_COVERED',
  'FEMALE_BREAST_COVERED',
  'BUTTOCKS_COVERED'
] as const

export type DetectionLabel = (typeof ALL_LABELS)[number]

// Group labels by category for the UI
export const LABEL_CATEGORIES = {
  FEMALE: [
    'FEMALE_BREAST_EXPOSED',
    'FEMALE_BREAST_COVERED',
    'FEMALE_GENITALIA_EXPOSED',
    'FEMALE_GENITALIA_COVERED',
    'FACE_FEMALE'
  ],
  MALE: ['MALE_BREAST_EXPOSED', 'MALE_GENITALIA_EXPOSED', 'FACE_MALE'],
  BODY: [
    'BUTTOCKS_EXPOSED',
    'BUTTOCKS_COVERED',
    'BELLY_EXPOSED',
    'BELLY_COVERED',
    'ANUS_EXPOSED',
    'ANUS_COVERED'
  ],
  EXTREMITIES: [
    'FEET_EXPOSED',
    'FEET_COVERED',
    'ARMPITS_EXPOSED',
    'ARMPITS_COVERED'
  ]
} as const

export const DEFAULT_ENABLED: DetectionLabel[] = [
  'FEMALE_BREAST_EXPOSED',
  'FEMALE_GENITALIA_EXPOSED',
  'MALE_GENITALIA_EXPOSED',
  'BUTTOCKS_EXPOSED',
  'ANUS_EXPOSED'
]

interface CensorState {
  enabledClasses: Set<string>
  censorType: CensorType
  intensity: number
  confidenceThreshold: number
  masterSize: number
  masterShape: CensorShape
  masterStroke: StrokeLayer
  masterBaseImage: BaseImageLayer
  masterOverlayImage: OverlayImageLayer
  masterText: TextLayer
  strokeTargets: string[]
  perCategorySize: Record<string, number>
  masterFeatherPx: number
  phrases: Phrase[]
  fonts: FontInfo[]
  imageAssets: ImageAsset[]
  isActive: boolean
  fps: number
  detectionCount: number
}

interface GridState {
  folders: string[]
  layoutMode: 'puzzle' | '2x2' | '3x3' | '4x4'
  density: number
  audioEffects: string[]
  audioEffectIntensities: Record<string, number>
}

export type HypnoContentType = 'all' | 'video' | 'image'

interface HypnoState {
  folders: string[]
  visualEffects: string[]
  audioEffects: string[]
  audioEffectIntensities: Record<string, number>
  effectIntensity: number
  speed: number
  videoDurationSec: number  // used for videos when playVideosToEnd is false
  imageDurationSec: number  // used for images (always)
  playVideosToEnd: boolean
  contentType: HypnoContentType
  phrases: string[]
  phraseIntervalSec: number
  phraseRandomOrder: boolean
  // Text overlay
  textOverlayEnabled: boolean
  textColor: string
  textSizePct: number       // % of min(canvas width, height)
  textStrokeEnabled: boolean
  textStrokeColor: string
  textGlowEnabled: boolean
  textGlowColor: string
}

interface AppState {
  mode: AppMode
  wsConnected: boolean
  censor: CensorState
  grid: GridState
  hypno: HypnoState

  // Actions
  setMode: (mode: AppMode) => void
  setWsConnected: (connected: boolean) => void

  // Censor actions
  toggleClass: (label: string) => void
  setEnabledClasses: (classes: string[]) => void
  setCensorType: (type: CensorType) => void
  setIntensity: (value: number) => void
  setConfidenceThreshold: (value: number) => void
  setMasterSize: (value: number) => void
  setMasterShape: (shape: CensorShape) => void
  setMasterStroke: (patch: Partial<StrokeLayer>) => void
  setMasterBaseImage: (patch: Partial<BaseImageLayer>) => void
  setMasterOverlayImage: (patch: Partial<OverlayImageLayer>) => void
  setMasterText: (patch: Partial<TextLayer>) => void
  setLayerTargets: (layer: TargetLayer, targets: string[]) => void
  setCategorySize: (label: string, value: number | null) => void
  setMasterFeatherPx: (px: number) => void
  setPhrases: (phrases: Phrase[]) => void
  setFonts: (fonts: FontInfo[]) => void
  setImageAssets: (assets: ImageAsset[]) => void
  setCensorActive: (active: boolean) => void
  setCensorStatus: (fps: number, detections: number) => void
  hydrateCensor: (patch: Partial<CensorState>) => void

  // Grid actions
  setGridFolders: (folders: string[]) => void
  addGridFolder: (folder: string) => void
  removeGridFolder: (folder: string) => void
  setGridLayout: (mode: GridState['layoutMode']) => void
  setGridDensity: (density: number) => void
  toggleGridAudioEffect: (effect: string) => void
  setGridAudioEffectIntensity: (effect: string, value: number) => void

  // Hypno actions
  setHypnoFolders: (folders: string[]) => void
  addHypnoFolder: (folder: string) => void
  removeHypnoFolder: (folder: string) => void
  toggleHypnoVisualEffect: (effect: string) => void
  setHypnoVisualEffects: (effects: string[]) => void
  toggleHypnoAudioEffect: (effect: string) => void
  setHypnoAudioEffectIntensity: (effect: string, value: number) => void
  setHypnoIntensity: (value: number) => void
  setHypnoSpeed: (value: number) => void
  setHypnoVideoDuration: (seconds: number) => void
  setHypnoImageDuration: (seconds: number) => void
  setHypnoPlayVideosToEnd: (value: boolean) => void
  setHypnoContentType: (value: HypnoContentType) => void
  addHypnoPhrase: (text: string) => void
  removeHypnoPhraseAt: (index: number) => void
  clearHypnoPhrases: () => void
  setHypnoPhraseInterval: (seconds: number) => void
  setHypnoPhraseRandomOrder: (value: boolean) => void
  setHypnoTextOverlayEnabled: (value: boolean) => void
  setHypnoTextColor: (hex: string) => void
  setHypnoTextSizePct: (value: number) => void
  setHypnoTextStrokeEnabled: (value: boolean) => void
  setHypnoTextStrokeColor: (hex: string) => void
  setHypnoTextGlowEnabled: (value: boolean) => void
  setHypnoTextGlowColor: (hex: string) => void
}

export const useStore = create<AppState>((set) => ({
  mode: 'censor',
  wsConnected: false,

  censor: {
    enabledClasses: new Set(DEFAULT_ENABLED),
    censorType: 'mosaic',
    intensity: 75,
    confidenceThreshold: 0.45,
    masterSize: 1.0,
    masterShape: 'rectangle',
    masterStroke: { ...DEFAULT_STROKE },
    masterBaseImage: { ...DEFAULT_BASE_IMAGE },
    masterOverlayImage: { ...DEFAULT_OVERLAY_IMAGE },
    masterText: { ...DEFAULT_TEXT },
    strokeTargets: [...DEFAULT_TARGETS],
    perCategorySize: {},
    masterFeatherPx: 0,
    phrases: [],
    fonts: [],
    imageAssets: [],
    isActive: false,
    fps: 0,
    detectionCount: 0
  },

  grid: {
    folders: [],
    layoutMode: 'puzzle',
    density: 50,
    audioEffects: [],
    audioEffectIntensities: {}
  },

  hypno: {
    folders: [],
    visualEffects: [],
    audioEffects: [],
    audioEffectIntensities: {},
    effectIntensity: 50,
    speed: 50,
    videoDurationSec: 5,
    imageDurationSec: 5,
    playVideosToEnd: true,
    contentType: 'all',
    phrases: [],
    phraseIntervalSec: 4,
    phraseRandomOrder: true,
    textOverlayEnabled: false,
    textColor: '#ffffff',
    textSizePct: 9,
    textStrokeEnabled: false,
    textStrokeColor: '#000000',
    textGlowEnabled: false,
    textGlowColor: '#ff0066'
  },

  setMode: (mode) => set({ mode }),
  setWsConnected: (connected) => set({ wsConnected: connected }),

  // Censor
  toggleClass: (label) =>
    set((state) => {
      const classes = new Set(state.censor.enabledClasses)
      if (classes.has(label)) classes.delete(label)
      else classes.add(label)
      return { censor: { ...state.censor, enabledClasses: classes } }
    }),

  setEnabledClasses: (classes) =>
    set((state) => ({
      censor: { ...state.censor, enabledClasses: new Set(classes) }
    })),

  setCensorType: (type) =>
    set((state) => ({ censor: { ...state.censor, censorType: type } })),

  setIntensity: (value) =>
    set((state) => ({ censor: { ...state.censor, intensity: value } })),

  setConfidenceThreshold: (value) =>
    set((state) => ({
      censor: { ...state.censor, confidenceThreshold: value }
    })),

  setMasterSize: (value) =>
    set((state) => ({ censor: { ...state.censor, masterSize: value } })),

  setMasterShape: (shape) =>
    set((state) => ({ censor: { ...state.censor, masterShape: shape } })),

  setMasterStroke: (patch) =>
    set((state) => ({
      censor: { ...state.censor, masterStroke: { ...state.censor.masterStroke, ...patch } }
    })),

  setMasterBaseImage: (patch) =>
    set((state) => ({
      censor: {
        ...state.censor,
        masterBaseImage: { ...state.censor.masterBaseImage, ...patch }
      }
    })),

  setMasterOverlayImage: (patch) =>
    set((state) => ({
      censor: {
        ...state.censor,
        masterOverlayImage: { ...state.censor.masterOverlayImage, ...patch }
      }
    })),

  setMasterText: (patch) =>
    set((state) => ({
      censor: { ...state.censor, masterText: { ...state.censor.masterText, ...patch } }
    })),

  setLayerTargets: (layer, targets) =>
    set((state) => {
      // Currently only 'stroke' uses a layer-level target list.
      if (layer === 'stroke') {
        return { censor: { ...state.censor, strokeTargets: targets } }
      }
      return state
    }),

  setCategorySize: (label, value) =>
    set((state) => {
      const next = { ...state.censor.perCategorySize }
      if (value == null) delete next[label]
      else next[label] = value
      return { censor: { ...state.censor, perCategorySize: next } }
    }),

  setMasterFeatherPx: (px) =>
    set((state) => ({ censor: { ...state.censor, masterFeatherPx: px } })),

  setPhrases: (phrases) =>
    set((state) => ({ censor: { ...state.censor, phrases } })),

  setFonts: (fonts) =>
    set((state) => ({ censor: { ...state.censor, fonts } })),

  setImageAssets: (assets) =>
    set((state) => ({ censor: { ...state.censor, imageAssets: assets } })),

  setCensorActive: (active) =>
    set((state) => ({ censor: { ...state.censor, isActive: active } })),

  setCensorStatus: (fps, detections) =>
    set((state) => ({
      censor: { ...state.censor, fps, detectionCount: detections }
    })),

  hydrateCensor: (patch) =>
    set((state) => ({ censor: { ...state.censor, ...patch } })),

  // Grid
  setGridFolders: (folders) =>
    set((state) => ({ grid: { ...state.grid, folders } })),

  addGridFolder: (folder) =>
    set((state) => ({
      grid: {
        ...state.grid,
        folders: state.grid.folders.includes(folder)
          ? state.grid.folders
          : [...state.grid.folders, folder]
      }
    })),

  removeGridFolder: (folder) =>
    set((state) => ({
      grid: {
        ...state.grid,
        folders: state.grid.folders.filter((f) => f !== folder)
      }
    })),

  setGridLayout: (mode) =>
    set((state) => ({ grid: { ...state.grid, layoutMode: mode } })),

  setGridDensity: (density) =>
    set((state) => ({ grid: { ...state.grid, density } })),

  toggleGridAudioEffect: (effect) =>
    set((state) => {
      const effects = state.grid.audioEffects.includes(effect)
        ? state.grid.audioEffects.filter((e) => e !== effect)
        : [...state.grid.audioEffects, effect]
      const nextIntensities = { ...state.grid.audioEffectIntensities }
      if (!effects.includes(effect)) {
        delete nextIntensities[effect]
      } else if (nextIntensities[effect] === undefined) {
        nextIntensities[effect] = 0.5
      }
      return {
        grid: {
          ...state.grid,
          audioEffects: effects,
          audioEffectIntensities: nextIntensities
        }
      }
    }),

  setGridAudioEffectIntensity: (effect, value) =>
    set((state) => ({
      grid: {
        ...state.grid,
        audioEffectIntensities: {
          ...state.grid.audioEffectIntensities,
          [effect]: Math.max(0, Math.min(1, value))
        }
      }
    })),

  // Hypno
  setHypnoFolders: (folders) =>
    set((state) => ({ hypno: { ...state.hypno, folders } })),

  addHypnoFolder: (folder) =>
    set((state) => ({
      hypno: {
        ...state.hypno,
        folders: state.hypno.folders.includes(folder)
          ? state.hypno.folders
          : [...state.hypno.folders, folder]
      }
    })),

  removeHypnoFolder: (folder) =>
    set((state) => ({
      hypno: {
        ...state.hypno,
        folders: state.hypno.folders.filter((f) => f !== folder)
      }
    })),

  toggleHypnoVisualEffect: (effect) =>
    set((state) => {
      const effects = state.hypno.visualEffects.includes(effect)
        ? state.hypno.visualEffects.filter((e) => e !== effect)
        : [...state.hypno.visualEffects, effect]
      return { hypno: { ...state.hypno, visualEffects: effects } }
    }),

  setHypnoVisualEffects: (effects) =>
    set((state) => ({ hypno: { ...state.hypno, visualEffects: effects } })),

  toggleHypnoAudioEffect: (effect) =>
    set((state) => {
      const effects = state.hypno.audioEffects.includes(effect)
        ? state.hypno.audioEffects.filter((e) => e !== effect)
        : [...state.hypno.audioEffects, effect]
      const nextIntensities = { ...state.hypno.audioEffectIntensities }
      if (!effects.includes(effect)) {
        delete nextIntensities[effect]
      } else if (nextIntensities[effect] === undefined) {
        nextIntensities[effect] = 0.5
      }
      return {
        hypno: {
          ...state.hypno,
          audioEffects: effects,
          audioEffectIntensities: nextIntensities
        }
      }
    }),

  setHypnoAudioEffectIntensity: (effect, value) =>
    set((state) => ({
      hypno: {
        ...state.hypno,
        audioEffectIntensities: {
          ...state.hypno.audioEffectIntensities,
          [effect]: Math.max(0, Math.min(1, value))
        }
      }
    })),

  setHypnoIntensity: (value) =>
    set((state) => ({ hypno: { ...state.hypno, effectIntensity: value } })),

  setHypnoSpeed: (value) =>
    set((state) => ({ hypno: { ...state.hypno, speed: value } })),

  setHypnoVideoDuration: (seconds) =>
    set((state) => ({
      hypno: { ...state.hypno, videoDurationSec: Math.max(0.5, seconds) }
    })),

  setHypnoImageDuration: (seconds) =>
    set((state) => ({
      hypno: { ...state.hypno, imageDurationSec: Math.max(0.5, seconds) }
    })),

  setHypnoPlayVideosToEnd: (value) =>
    set((state) => ({ hypno: { ...state.hypno, playVideosToEnd: value } })),

  setHypnoTextColor: (hex) =>
    set((state) => ({ hypno: { ...state.hypno, textColor: hex } })),

  setHypnoTextSizePct: (value) =>
    set((state) => ({
      hypno: { ...state.hypno, textSizePct: Math.max(1, Math.min(30, value)) }
    })),

  setHypnoTextStrokeEnabled: (value) =>
    set((state) => ({ hypno: { ...state.hypno, textStrokeEnabled: value } })),

  setHypnoTextStrokeColor: (hex) =>
    set((state) => ({ hypno: { ...state.hypno, textStrokeColor: hex } })),

  setHypnoTextGlowEnabled: (value) =>
    set((state) => ({ hypno: { ...state.hypno, textGlowEnabled: value } })),

  setHypnoTextGlowColor: (hex) =>
    set((state) => ({ hypno: { ...state.hypno, textGlowColor: hex } })),

  setHypnoContentType: (value) =>
    set((state) => ({ hypno: { ...state.hypno, contentType: value } })),

  addHypnoPhrase: (text) =>
    set((state) => {
      const trimmed = text.trim()
      if (!trimmed) return state
      return { hypno: { ...state.hypno, phrases: [...state.hypno.phrases, trimmed] } }
    }),

  removeHypnoPhraseAt: (index) =>
    set((state) => ({
      hypno: { ...state.hypno, phrases: state.hypno.phrases.filter((_, i) => i !== index) }
    })),

  clearHypnoPhrases: () =>
    set((state) => ({ hypno: { ...state.hypno, phrases: [] } })),

  setHypnoPhraseInterval: (seconds) =>
    set((state) => ({
      hypno: { ...state.hypno, phraseIntervalSec: Math.max(0.5, seconds) }
    })),

  setHypnoPhraseRandomOrder: (value) =>
    set((state) => ({ hypno: { ...state.hypno, phraseRandomOrder: value } })),

  setHypnoTextOverlayEnabled: (value) =>
    set((state) => ({ hypno: { ...state.hypno, textOverlayEnabled: value } }))
}))
