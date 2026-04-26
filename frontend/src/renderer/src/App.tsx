import { useEffect } from 'react'
import { useStore } from './lib/store'
import { useWebSocket } from './hooks/useWebSocket'
import { Sidebar } from './components/layout/Sidebar'
import { CensorPage } from './components/censor/CensorPage'
import { GridPage } from './components/grid/GridPage'
import { HypnoPage } from './components/hypno/HypnoPage'
import { StatusBar } from './components/layout/StatusBar'

export default function App() {
  const mode = useStore((s) => s.mode)
  const setWsConnected = useStore((s) => s.setWsConnected)
  const setCensorStatus = useStore((s) => s.setCensorStatus)
  const setCensorActive = useStore((s) => s.setCensorActive)
  const hydrateCensor = useStore((s) => s.hydrateCensor)

  const { connected, subscribe } = useWebSocket()

  // Sync connection state to store
  useEffect(() => {
    setWsConnected(connected)
  }, [connected, setWsConnected])

  // Subscribe to backend status updates
  useEffect(() => {
    const unsub1 = subscribe('censor.status', (data: any) => {
      setCensorStatus(data.fps || 0, data.detections || 0)
      setCensorActive(data.active || false)
    })

    const unsub2 = subscribe('config.full', (data: any) => {
      if (data.censor_active !== undefined) {
        setCensorActive(data.censor_active)
      }
      const c = data.censor
      if (c) {
        hydrateCensor({
          enabledClasses: new Set(c.enabled_classes ?? []),
          censorType: c.censor_type ?? 'mosaic',
          intensity: c.intensity ?? 75,
          confidenceThreshold: c.confidence_threshold ?? 0.45,
          masterSize: c.master_size ?? 1.0,
          masterShape: c.master_shape ?? 'rectangle',
          masterStroke: c.master_stroke ?? { enabled: false, color: '#ff0066', thickness: 2 },
          masterBaseImage: c.master_base_image ?? { assignments: [], stretch: 'cover' },
          masterOverlayImage: c.master_overlay_image ?? {
            enabled: false, assignments: [], scale_pct: 80, opacity: 1.0
          },
          masterText: c.master_text ?? {
            enabled: false, assignments: [], font_id: 'impact', color: '#ffffff',
            size_pct: 40, stroke_enabled: true, stroke_color: '#000000', stroke_px: 2
          },
          strokeTargets: c.stroke_targets ?? ['*'],
          perCategorySize: c.per_category_size ?? {},
          masterFeatherPx: c.master_feather_px ?? 0,
          phrases: data.phrases ?? [],
          imageAssets: data.image_assets ?? []
        })
      }
    })

    // config.updated broadcasts partial slices.
    const unsub3 = subscribe('config.updated', (data: any) => {
      if (data.image_assets !== undefined) {
        hydrateCensor({ imageAssets: data.image_assets })
      }
      if (data.phrases !== undefined) {
        hydrateCensor({ phrases: data.phrases })
      }
    })

    // Fetch available fonts once (non-blocking)
    fetch('http://127.0.0.1:9099/api/fonts')
      .then((r) => r.json())
      .then((body) => {
        if (body && Array.isArray(body.fonts)) hydrateCensor({ fonts: body.fonts })
      })
      .catch(() => {})

    return () => {
      unsub1()
      unsub2()
      unsub3()
    }
  }, [subscribe, setCensorStatus, setCensorActive, hydrateCensor])

  return (
    <div className="flex h-screen w-screen bg-bg-primary scanlines relative overflow-hidden">
      <Sidebar />

      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Title bar drag region */}
        <div className="h-9 flex items-center px-4 border-b border-border-subtle titlebar-drag shrink-0">
          <span className="text-text-secondary text-[10px] tracking-[0.3em] uppercase titlebar-no-drag">
            {mode === 'censor' && 'CENSORSHIP ENGINE'}
            {mode === 'grid' && 'GRID PLAYER'}
            {mode === 'hypno' && 'HYPNO VIEWER'}
          </span>
        </div>

        {/* Page content */}
        <div className="flex-1 overflow-hidden">
          {mode === 'censor' && <CensorPage />}
          {mode === 'grid' && <GridPage />}
          {mode === 'hypno' && <HypnoPage />}
        </div>

        <StatusBar />
      </main>
    </div>
  )
}
