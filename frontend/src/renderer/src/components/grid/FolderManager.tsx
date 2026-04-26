import { NeonButton } from '../shared/NeonButton'

interface FolderManagerProps {
  folders: string[]
  onAdd: (folder: string) => void
  onRemove: (folder: string) => void
}

export function FolderManager({ folders, onAdd, onRemove }: FolderManagerProps) {
  const handleAddFolder = async () => {
    const paths = await window.api.openFolder()
    for (const path of paths) {
      onAdd(path)
    }
  }

  return (
    <div className="bg-bg-secondary border border-border-subtle rounded p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[10px] text-neon-cyan uppercase tracking-[0.2em] text-glow-cyan">
          Sources
        </h3>
        <NeonButton size="sm" onClick={handleAddFolder}>
          + Add Folder
        </NeonButton>
      </div>

      {folders.length === 0 ? (
        <p className="text-xs text-text-disabled py-4 text-center">
          No folders selected. Add folders to start.
        </p>
      ) : (
        <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
          {folders.map((folder) => (
            <div
              key={folder}
              className="flex items-center justify-between bg-bg-primary rounded px-2 py-1.5 group"
            >
              <span className="text-xs text-text-secondary truncate mr-2" title={folder}>
                {formatFolderPath(folder)}
              </span>
              <button
                onClick={() => onRemove(folder)}
                className="text-text-disabled hover:text-neon-red text-xs shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatFolderPath(path: string): string {
  // Show last 2 path segments for brevity
  const parts = path.replace(/\\/g, '/').split('/')
  if (parts.length <= 2) return path
  return '.../' + parts.slice(-2).join('/')
}
