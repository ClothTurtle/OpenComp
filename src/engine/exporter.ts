// Real-time export: plays the timeline while recording the viewer canvas and the audio mix with
// MediaRecorder. No dependencies and it uses the browser's hardware encoders, but it takes as long
// as the video. A faster frame-by-frame exporter (WebCodecs) can replace this later.
import { contentEnd } from '../lib/timeline'
import { getState, useStore } from '../store'
import { audioStream } from './media'
import { pause, play, requestRender, seek, setExportRange, viewerCanvas } from './playback'

export interface ExportFormat {
  label: string
  ext: string
  mime: string
}

const CANDIDATES = [
  { label: 'MP4 (H.264)', ext: 'mp4', mimes: ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4'] },
  { label: 'WebM', ext: 'webm', mimes: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'] },
]

/** Formats this browser can record, best first. */
export function supportedFormats(): ExportFormat[] {
  if (typeof MediaRecorder === 'undefined') return []
  return CANDIDATES.flatMap(({ label, ext, mimes }) => {
    const mime = mimes.find((m) => MediaRecorder.isTypeSupported(m))
    return mime ? [{ label, ext, mime }] : []
  })
}

export interface ExportJob {
  done: Promise<Blob | null> // null if cancelled
  cancel(): void
}

export function exportVideo(format: ExportFormat, workAreaOnly: boolean, onProgress: (fraction: number) => void): ExportJob {
  const canvas = viewerCanvas()
  const { project, time: returnTo } = getState()
  const [from, to] = workAreaOnly && project.workArea ? project.workArea : [0, contentEnd(project)]
  if (!canvas || to <= from) throw new Error('There is nothing on the timeline to export.')

  const { width, height, fps } = project.settings
  pause()
  setExportRange([from, to])
  seek(from)
  requestRender()

  const stream = canvas.captureStream(fps)
  for (const track of audioStream().getAudioTracks()) stream.addTrack(track)
  const recorder = new MediaRecorder(stream, {
    mimeType: format.mime,
    videoBitsPerSecond: Math.round(width * height * fps * 0.15),
  })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }

  let cancelled = false
  let unsubscribe = () => {}
  let finish: (blob: Blob | null) => void = () => {}
  const done = new Promise<Blob | null>((resolve) => (finish = resolve))
  const cleanup = () => {
    unsubscribe()
    for (const track of stream.getVideoTracks()) track.stop() // the audio track is shared; leave it running
    setExportRange(null)
    seek(returnTo)
  }
  recorder.onstop = () => {
    cleanup()
    finish(cancelled ? null : new Blob(chunks, { type: format.mime.split(';')[0] }))
  }

  // Give the first frames a moment to decode before recording starts.
  const startTimer = setTimeout(() => {
    recorder.start(1000)
    play()
    unsubscribe = useStore.subscribe((s) => {
      onProgress(Math.min(1, (s.time - from) / (to - from)))
      if (!s.playing && recorder.state === 'recording') recorder.stop()
    })
  }, 500)

  return {
    done,
    cancel() {
      cancelled = true
      clearTimeout(startTimer)
      pause()
      if (recorder.state !== 'inactive') recorder.stop()
      else {
        cleanup()
        finish(null)
      }
    },
  }
}
