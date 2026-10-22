import { useEffect, useState } from 'react'

/**
 * Corner ghost. Squashes and stretches while a briefing line is being read,
 * then rests. Dismiss hides it for the rest of the session.
 */
export default function GhostBriefing({ lines, extraTalking = false }) {
  const [dismissed, setDismissed] = useState(false)
  const [shown, setShown] = useState([])
  const [partial, setPartial] = useState('')
  const script = (lines || []).join('\n')

  useEffect(() => {
    if (dismissed) return undefined
    const queue = script ? script.split('\n') : []

    if (queue.length === 0) {
      setShown([])
      setPartial('')
      return undefined
    }

    let line = 0
    let char = 0
    let wait = 0
    setShown([])
    setPartial('')

    const id = setInterval(() => {
      if (wait > 0) {
        wait -= 1
        return
      }
      const text = queue[line] || ''
      char += 1
      if (char < text.length) {
        setPartial(text.slice(0, char))
        return
      }
      setShown((prev) => [...prev, text])
      setPartial('')
      line += 1
      char = 0
      if (line >= queue.length) {
        clearInterval(id)
        return
      }
      wait = 12
    }, 16)

    return () => clearInterval(id)
  }, [script, dismissed])

  if (dismissed) return null

  const stillReading = partial.length > 0 || shown.length < (lines?.length || 0)
  const squish = stillReading || extraTalking

  return (
    <div className="ghost-dock">
      <div className="ghost-bubble">
        <div className="ghost-bubble-head">
          <span className="ghost-kicker">Briefing</span>
          <button
            type="button"
            className="ghost-dismiss"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss briefing"
          >
            ×
          </button>
        </div>
        <div className="ghost-lines" aria-live="polite">
          {shown.map((line, index) => (
            <p key={index}>{line}</p>
          ))}
          {partial && <p className="ghost-partial">{partial}</p>}
        </div>
      </div>
      <div
        className={squish ? 'ghost-figure talking' : 'ghost-figure'}
        aria-hidden="true"
      >
        <img src="/kiro-ghost.png" alt="" draggable="false" />
      </div>
    </div>
  )
}
