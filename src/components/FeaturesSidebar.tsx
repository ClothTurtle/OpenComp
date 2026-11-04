import { ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { FEATURES, type Feature } from '../features'
import { EFFECT_DRAG_TYPE } from '../lib/files'
import { setFeatureEnabled, updateSettings, useSettings } from '../settings'
import { useStore } from '../store'
import { Panel } from './Panel'
import { IconButton, Toggle } from './ui'

/**
 * Every optional feature and effect in one searchable list. Toggle anything off to hide it from the
 * app; effects and presets can be applied to the selected clip (or dragged onto a clip).
 */
export function FeaturesSidebar() {
  const disabled = useSettings((s) => s.disabledFeatures)
  const hasClip = useStore((s) => !!s.selectedClipId)
  const [query, setQuery] = useState('')
  const [onlyEnabled, setOnlyEnabled] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const q = query.trim().toLowerCase()
  const groups = useMemo(() => {
    const map = new Map<string, Feature[]>()
    for (const f of FEATURES) {
      if (onlyEnabled && disabled.includes(f.id)) continue
      if (q && !`${f.name} ${f.category} ${f.description} ${f.keywords ?? ''}`.toLowerCase().includes(q)) continue
      map.set(f.category, [...(map.get(f.category) ?? []), f])
    }
    return [...map]
  }, [q, onlyEnabled, disabled])

  const toggleGroup = (cat: string) =>
    setCollapsed((s) => {
      const next = new Set(s)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })

  const enabledCount = FEATURES.length - disabled.filter((id) => FEATURES.some((f) => f.id === id)).length

  return (
    <Panel title="Features & Effects" className="features-panel" actions={<IconButton icon={X} title="Hide sidebar (Ctrl+B)" onClick={() => updateSettings({ showSidebar: false })} />}>
      <div className="feature-search">
        <Search size={13} />
        <input placeholder="Search features & effects" value={query} onChange={(e) => setQuery(e.target.value)} />
        {query && <IconButton icon={X} title="Clear search" onClick={() => setQuery('')} />}
      </div>
      <div className="feature-summary">
        <span>
          {enabledCount} of {FEATURES.length} on
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
        {groups.map(([category, items]) => {
          const open = !!q || !collapsed.has(category)
          return (
            <section key={category}>
              <button type="button" className="feature-cat" onClick={() => toggleGroup(category)} aria-expanded={open}>
                {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <span>{category}</span>
                <span className="count">{items.length}</span>
              </button>
              {open && items.map((f) => <FeatureRow key={f.id} feature={f} on={!disabled.includes(f.id)} hasClip={hasClip} />)}
            </section>
          )
        })}
        {groups.length === 0 && <div className="empty-note">Nothing matches “{query}”.</div>}
      </div>
    </Panel>
  )
}

function FeatureRow({ feature: f, on, hasClip }: { feature: Feature; on: boolean; hasClip: boolean }) {
  const isEffect = f.id.startsWith('fx:')
  const needsSelection = !!f.action?.needsClip && !hasClip
  return (
    <div
      className={`feature-row ${on ? '' : 'off'}`}
      draggable={isEffect && on}
      onDragStart={(e) => {
        e.dataTransfer.setData(EFFECT_DRAG_TYPE, f.id.slice(3))
        e.dataTransfer.effectAllowed = 'copy'
      }}
      title={isEffect && on ? `${f.description}\nDrag onto a clip, or select a clip and click Apply.` : f.description}
    >
      <div className="feature-text">
        <span className="feature-name">{f.name}</span>
        <span className="feature-desc">{f.description}</span>
      </div>
      {f.action && (
        <button
          type="button"
          className="btn small"
          disabled={!on || needsSelection}
          title={needsSelection ? 'Select a clip first' : undefined}
          onClick={f.action.run}
        >
          {f.action.label}
        </button>
      )}
      <Toggle on={on} onChange={(v) => setFeatureEnabled(f.id, v)} label={f.name} />
    </div>
  )
}
