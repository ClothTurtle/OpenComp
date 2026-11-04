import { ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { FEATURES, type Feature, type FeaturePage } from '../features'
import { EFFECT_DRAG_TYPE } from '../lib/files'
import { setFeatureEnabled, updateSettings, useSettings } from '../settings'
import { useStore } from '../store'
import { Panel } from './Panel'
import { IconButton, Toggle } from './ui'

const PAGES: { id: FeaturePage; label: string; note: string }[] = [
  { id: 'essentials', label: 'Essentials', note: '' },
  {
    id: 'advanced',
    label: 'Advanced (AE)',
    note: 'After Effects-style effects, by After Effects category. Select a clip and click Apply (or drag an effect onto a clip).',
  },
]

/**
 * Every optional feature and effect in one searchable list, on two pages: the essentials and the
 * After Effects-style advanced effects. Toggle anything off to hide it from the app; the button on a
 * row (or a double-click) uses it straight away: effects are applied and open their own window.
 */
export function FeaturesSidebar() {
  const disabled = useSettings((s) => s.disabledFeatures)
  const hasClip = useStore((s) => !!s.selectedClipId)
  const [page, setPage] = useState<FeaturePage>('essentials')
  const [query, setQuery] = useState('')
  const [onlyEnabled, setOnlyEnabled] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const q = query.trim().toLowerCase()
  const matches = useMemo(
    () =>
      FEATURES.filter(
        (f) =>
          !(onlyEnabled && disabled.includes(f.id)) &&
          (!q || `${f.name} ${f.category} ${f.description} ${f.keywords ?? ''}`.toLowerCase().includes(q)),
      ),
    [q, onlyEnabled, disabled],
  )
  const groups = useMemo(() => {
    const map = new Map<string, Feature[]>()
    for (const f of matches) if ((f.page ?? 'essentials') === page) map.set(f.category, [...(map.get(f.category) ?? []), f])
    return [...map]
  }, [matches, page])
  const otherPage = PAGES.find((p) => p.id !== page)!
  const otherMatches = q ? matches.filter((f) => (f.page ?? 'essentials') === otherPage.id).length : 0

  const toggleGroup = (cat: string) =>
    setCollapsed((s) => {
      const next = new Set(s)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })

  const ids = new Set(FEATURES.map((f) => f.id))
  const enabledCount = ids.size - disabled.filter((id) => ids.has(id)).length
  const note = PAGES.find((p) => p.id === page)!.note

  return (
    <Panel title="Features & Effects" className="features-panel" actions={<IconButton icon={X} title="Hide sidebar (Ctrl+B)" onClick={() => updateSettings({ showSidebar: false })} />}>
      <div className="feature-tabs" role="tablist">
        {PAGES.map((p) => (
          <button key={p.id} type="button" role="tab" aria-selected={page === p.id} onClick={() => setPage(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="feature-search">
        <Search size={13} />
        <input placeholder="Search features & effects" value={query} onChange={(e) => setQuery(e.target.value)} />
        {query && <IconButton icon={X} title="Clear search" onClick={() => setQuery('')} />}
      </div>
      <div className="feature-summary">
        <span>
          {enabledCount} of {ids.size} on
        </span>
        <label className="check">
          <input type="checkbox" checked={onlyEnabled} onChange={(e) => setOnlyEnabled(e.target.checked)} /> Enabled only
        </label>
        {disabled.length > 0 && (
          <button type="button" className="link" onClick={() => updateSettings({ disabledFeatures: [] })}>
            Turn all on
          </button>
        )}
      </div>
      <div className="feature-list">
        {note && !q && <div className="feature-page-note">{note}</div>}
        {groups.map(([category, items]) => {
          const open = !!q || !collapsed.has(category)
          return (
            <section key={category}>
              <button type="button" className="feature-cat" onClick={() => toggleGroup(category)} aria-expanded={open}>
                {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <span>{category}</span>
                <span className="count">{items.length}</span>
              </button>
              {open && items.map((f) => <FeatureRow key={`${f.id}:${f.name}`} feature={f} on={!disabled.includes(f.id)} hasClip={hasClip} />)}
            </section>
          )
        })}
        {groups.length === 0 && <div className="empty-note">Nothing here matches “{query}”.</div>}
        {otherMatches > 0 && (
          <button type="button" className="link feature-page-note" onClick={() => setPage(otherPage.id)}>
            {otherMatches} more on the {otherPage.label} page →
          </button>
        )}
      </div>
    </Panel>
  )
}

function FeatureRow({ feature: f, on, hasClip }: { feature: Feature; on: boolean; hasClip: boolean }) {
  const isEffect = f.id.startsWith('fx:')
  const action = f.action
  const usable = !!action && on && !(action.needsClip && !hasClip)
  const active = useSettings((s) => !!action?.active?.(s))
  return (
    <div
      className={`feature-row ${on ? '' : 'off'}`}
      draggable={isEffect && on}
      onDragStart={(e) => {
        e.dataTransfer.setData(EFFECT_DRAG_TYPE, f.id.slice(3))
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onDoubleClick={(e) => usable && !(e.target as HTMLElement).closest('button, input') && action!.run()}
      title={isEffect && on ? `${f.description}\nDouble-click or Apply to add it to the selected clip, or drag it onto a clip.` : f.description}
    >
      <div className="feature-text">
        <span className="feature-name">{f.name}</span>
        <span className="feature-desc">{f.description}</span>
      </div>
      {action && (
        <button
          type="button"
          className={`btn small ${active ? 'active' : ''}`}
          aria-pressed={action.active ? active : undefined}
          disabled={!usable}
          title={on && action.needsClip && !hasClip ? 'Select a clip first' : undefined}
          onClick={action.run}
        >
          {action.label}
        </button>
      )}
      <Toggle on={on} onChange={(v) => setFeatureEnabled(f.id, v)} label={f.name} />
    </div>
  )
}
