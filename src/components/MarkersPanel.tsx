import { Plus, X } from 'lucide-react'
import { addMarker, removeMarker, updateMarker } from '../actions'
import { seek } from '../engine/playback'
import { timecode } from '../lib/time'
import { useStore } from '../store'
import { Panel } from './Panel'
import { IconButton } from './ui'

/** Bookmarks: jump to them, label them, delete them. They also show on the timeline ruler. */
export function MarkersPanel() {
  const markers = useStore((s) => s.project.markers)
  const fps = useStore((s) => s.project.settings.fps)

  return (
    <Panel title="Markers" actions={<IconButton icon={Plus} title="Add marker at playhead (M)" onClick={() => addMarker()} />}>
      {markers.length === 0 ? (
        <div className="empty-note">
          <span>
            Press <kbd>M</kbd> to bookmark the current frame.
          </span>
        </div>
      ) : (
        <ul className="marker-list">
          {markers.map((m) => (
            <li key={m.id}>
              <span className="marker-dot" style={{ background: m.color }} />
              <button type="button" className="link timecode" title="Jump to marker" onClick={() => seek(m.time)}>
                {timecode(m.time, fps)}
              </button>
              <input
                value={m.label}
                placeholder="Add a label"
                aria-label="Marker label"
                onChange={(e) => updateMarker(m.id, { label: e.target.value }, `marker:${m.id}`)}
              />
              <IconButton icon={X} title="Delete marker" onClick={() => removeMarker(m.id)} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
