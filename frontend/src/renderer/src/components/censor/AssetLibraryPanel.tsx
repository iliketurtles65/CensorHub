import { useCallback, useState } from 'react'
import { useStore, type ImageAsset } from '../../lib/store'

const API_BASE = 'http://127.0.0.1:9099'

declare global {
  interface Window {
    api: {
      openFile: (filters?: any) => Promise<string[]>
      openFolder: () => Promise<string[]>
      readFile: (path: string) => Promise<{ name: string; bytes: ArrayBuffer }>
    }
  }
}

interface AssetLibraryPanelProps {
  /** Currently-selected asset IDs for the current pool. */
  selectedIds: string[]
  /** Toggle an asset in/out of the pool. */
  onToggle: (assetId: string) => void
  /** Optional height class for the grid. */
  maxHeightClass?: string
}

async function uploadOne(path: string): Promise<ImageAsset | null> {
  try {
    const { name, bytes } = await window.api.readFile(path)
    const fd = new FormData()
    fd.append('file', new Blob([bytes]), name)
    const res = await fetch(`${API_BASE}/api/assets/image`, { method: 'POST', body: fd })
    if (!res.ok) {
      console.error('Upload failed:', await res.text())
      return null
    }
    return (await res.json()) as ImageAsset
  } catch (e) {
    console.error('Upload error:', e)
    return null
  }
}

async function deleteAsset(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/assets/image/${id}`, { method: 'DELETE' })
    return res.ok
  } catch (e) {
    console.error('Delete error:', e)
    return false
  }
}

export function AssetLibraryPanel({
  selectedIds,
  onToggle,
  maxHeightClass = 'max-h-56'
}: AssetLibraryPanelProps) {
  const assets = useStore((s) => s.censor.imageAssets)
  const [uploading, setUploading] = useState(false)

  const handleUpload = useCallback(async () => {
    const paths = await window.api.openFile([
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }
    ])
    if (!paths.length) return
    setUploading(true)
    try {
      await Promise.all(paths.map(uploadOne))
      // Backend broadcasts config.updated → store hydrates from subscription
    } finally {
      setUploading(false)
    }
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    await deleteAsset(id)
  }, [])

  const selected = new Set(selectedIds)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-text-secondary">
          Library ({assets.length})
        </span>
        <button
          onClick={handleUpload}
          disabled={uploading}
          className="text-[10px] px-2 py-1 rounded border border-neon-cyan text-neon-cyan
            hover:bg-neon-cyan/10 cursor-pointer transition-colors disabled:opacity-50"
        >
          {uploading ? 'UPLOADING...' : '+ UPLOAD'}
        </button>
      </div>

      {assets.length === 0 ? (
        <p className="text-[10px] text-text-disabled py-4 text-center border border-dashed border-border-subtle rounded">
          No images yet. Click UPLOAD to add one or more.
        </p>
      ) : (
        <div className={`grid grid-cols-4 gap-1.5 overflow-y-auto ${maxHeightClass}`}>
          {assets.map((a) => {
            const on = selected.has(a.id)
            return (
              <div
                key={a.id}
                className={`relative group aspect-square rounded border-2 cursor-pointer transition-all ${
                  on
                    ? 'border-neon-pink shadow-[0_0_10px_#ff006680]'
                    : 'border-border-subtle opacity-70 hover:opacity-100'
                }`}
                onClick={() => onToggle(a.id)}
                title={`${a.filename} (${a.w}×${a.h})`}
              >
                <img
                  src={`${API_BASE}/api/assets/image/${a.id}/thumb`}
                  className="w-full h-full object-contain bg-bg-primary rounded-sm"
                  alt={a.filename}
                  draggable={false}
                />
                {on && (
                  <div className="absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-neon-pink text-[8px] flex items-center justify-center text-bg-primary font-bold">
                    ✓
                  </div>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(a.id)
                  }}
                  className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-neon-red/80 text-[10px]
                    text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  title="Delete image"
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
