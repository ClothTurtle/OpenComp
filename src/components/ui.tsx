// Small shared building blocks.
import { Film, Image as ImageIcon, Music, type LucideIcon } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import type { AssetKind } from '../project'
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

const KIND_ICONS: Record<AssetKind, LucideIcon> = { video: Film, audio: Music, image: ImageIcon }

export function KindIcon({ kind, size = 13 }: { kind: AssetKind; size?: number }) {
  const Icon = KIND_ICONS[kind]
  return <Icon size={size} strokeWidth={1.75} className={`kind-icon kind-${kind}`} />
}

export const closeDialog = () => setState({ dialog: null })

export function Modal({
  title,
  children,
  footer,
  onClose = closeDialog,
}: {
  title: string
  children: ReactNode
  footer?: ReactNode
  onClose?: () => void
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
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">{title}</header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  )
}
