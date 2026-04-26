import { useStore, ALL_TARGET } from '../../lib/store'
import { LayerCard } from './LayerCard'
import { TargetSelector } from './TargetSelector'
import { BaseEditor } from './layers/BaseEditor'
import { ShapeEditor } from './layers/ShapeEditor'
import { StrokeEditor } from './layers/StrokeEditor'
import { TextEditor } from './layers/TextEditor'
import { BaseImageEditor } from './layers/BaseImageEditor'
import { OverlayImageEditor } from './layers/OverlayImageEditor'

function summarizeLayerTargets(targets: string[], totalEnabled: number): string {
  if (targets.includes(ALL_TARGET)) {
    return totalEnabled === 0 ? 'All' : `All (${totalEnabled})`
  }
  if (targets.length === 0) return 'None'
  if (targets.length === 1) return '1 category'
  return `${targets.length} categories`
}

function summarizeAssignments(count: number): string {
  if (count === 0) return 'No items'
  if (count === 1) return '1 item'
  return `${count} items`
}

function StrokeCardHeader() {
  const enabled = useStore((s) => s.censor.masterStroke.enabled)
  const targets = useStore((s) => s.censor.strokeTargets)
  const enabledCount = useStore((s) => s.censor.enabledClasses.size)
  return (
    <LayerCard
      title="STROKE"
      active={enabled}
      summary={enabled ? summarizeLayerTargets(targets, enabledCount) : 'Disabled'}
    >
      <StrokeEditor />
      <TargetSelector layer="stroke" />
    </LayerCard>
  )
}

function OverlayCardHeader() {
  const enabled = useStore((s) => s.censor.masterOverlayImage.enabled)
  const assignmentCount = useStore(
    (s) => s.censor.masterOverlayImage.assignments.length
  )
  const active = enabled && assignmentCount > 0
  return (
    <LayerCard
      title="IMAGE OVERLAY"
      active={active}
      summary={active ? summarizeAssignments(assignmentCount) : 'Disabled'}
    >
      <OverlayImageEditor />
    </LayerCard>
  )
}

function TextCardHeader() {
  const enabled = useStore((s) => s.censor.masterText.enabled)
  const assignmentCount = useStore((s) => s.censor.masterText.assignments.length)
  const active = enabled && assignmentCount > 0
  return (
    <LayerCard
      title="TEXT"
      active={active}
      summary={active ? summarizeAssignments(assignmentCount) : 'Disabled'}
    >
      <TextEditor />
    </LayerCard>
  )
}

function BaseCardHeader() {
  const censorType = useStore((s) => s.censor.censorType)
  return (
    <LayerCard title="BASE" active>
      <BaseEditor />
      {censorType === 'image' && (
        <div className="mt-3 pt-3 border-t border-border-subtle/40">
          <p className="text-[10px] uppercase tracking-wider text-text-secondary mb-2">
            Image Pool
          </p>
          <BaseImageEditor />
        </div>
      )}
    </LayerCard>
  )
}

function ShapeCardHeader() {
  return (
    <LayerCard title="SHAPE" accent="cyan" active>
      <ShapeEditor />
    </LayerCard>
  )
}

export function LayerStackPanel() {
  // Scroll behavior lives on the parent container in CensorPage. This is just
  // a vertical stack of cards — let it grow naturally.
  return (
    <div className="flex flex-col gap-2 p-3">
      <BaseCardHeader />
      <StrokeCardHeader />
      <OverlayCardHeader />
      <TextCardHeader />
      <ShapeCardHeader />
    </div>
  )
}
