// Small shared building blocks.
import { Film, Image as ImageIcon, Music, SlidersHorizontal, Square, Type, type LucideIcon } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import type { LayerKind } from '../project'
import { setState } from '../store'

export function IconButton({
  icon: Icon,
  title,
  onClick,
  active = false,
  disabled = false,
  className = '',
}: {
  icon: LucideIcon
  title: string
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      className={`icon-btn ${active ? 'active' : ''} ${className}`}
      title={title}
      aria-label={title}
      aria-pressed={active || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={15} strokeWidth={1.75} />
    </button>
  )
}

/** An on/off switch. */
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={on ? `${label}: on` : `${label}: off`}
      className={`switch ${on ? 'on' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!on)
      }}
    >
      <span />
    </button>
  )
}

const KIND_ICONS: Record<LayerKind, LucideIcon> = {
  video: Film,
  audio: Music,
  image: ImageIcon,
  text: Type,
  solid: Square,
  adjustment: SlidersHorizontal,
}

export function KindIcon({ kind, size = 13 }: { kind: LayerKind; size?: number }) {
  const Icon = KIND_ICONS[kind]
  return <Icon size={size} strokeWidth={1.75} className={`kind-icon kind-${kind}`} />
}

export const closeDialog = () => setState({ dialog: null })

export function Modal({
  title,
  children,
  footer,
  onClose = closeDialog,
  wide = false,
}: {
  title: string
  children: ReactNode
  footer?: ReactNode
  onClose?: () => void
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">{title}</header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  )
}

/** Panel title made of tabs. */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (id: T) => void }) {
  return (
    <span className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          className={`tab ${t.id === value ? 'active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </span>
  )
}
