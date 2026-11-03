import { Maximize2, Minimize2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { IconButton } from './ui'

/** Panel chrome: title bar, optional actions and footer. Double-click the title bar (or Esc) to maximize/restore. */
export function Panel({
  title,
  actions,
  footer,
  children,
  className = '',
}: {
  title: ReactNode
  actions?: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
}) {
  const [maximized, setMaximized] = useState(false)
  const toggle = () => setMaximized((m) => !m)

  useEffect(() => {
    if (!maximized) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMaximized(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [maximized])

  return (
    <section className={`panel ${className} ${maximized ? 'maximized' : ''}`}>
      <header className="panel-header" onDoubleClick={toggle} title="Double-click to maximize">
        <span className="panel-title">{title}</span>
        <div className="panel-actions" onDoubleClick={(e) => e.stopPropagation()}>
          {actions}
          <IconButton
            icon={maximized ? Minimize2 : Maximize2}
            title={maximized ? 'Restore panel (Esc)' : 'Maximize panel'}
            onClick={toggle}
          />
        </div>
      </header>
      <div className="panel-body">{children}</div>
      {footer && <footer className="panel-footer">{footer}</footer>}
    </section>
  )
}
