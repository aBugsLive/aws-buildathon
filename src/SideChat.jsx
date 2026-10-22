import { useEffect, useRef, useState } from 'react'
import { answerQuestion } from './briefing.js'

export default function SideChat({ open, onClose, season, summary, windowText, onReply }) {
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const logRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    inputRef.current?.focus()
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [messages, open])

  function submit(event) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    const reply = answerQuestion(text, { season, summary, windowText })
    setMessages((prev) => [
      ...prev,
      { role: 'user', text },
      { role: 'briefing', text: reply },
    ])
    setDraft('')
    onReply?.()
  }

  return (
    <section
      id="side-chat"
      className={open ? 'side-chat' : 'side-chat closed'}
      aria-hidden={!open}
      aria-label="Briefing chat"
    >
      <header className="side-chat-head">
        <h2>WA HeatMap Assistant</h2>
        <p>Answers use the numbers already on this page.</p>
      </header>
      <div className="side-chat-log" ref={logRef}>
        {messages.length === 0 && (
          <p className="side-chat-empty">
            Ask about seasonal activity for this time of year, or which Northeast
            fire is largest by acres. Nothing you type is sent to a model.
          </p>
        )}
        {messages.map((message, index) => (
          <p key={`${message.role}-${index}`} className={`chat-${message.role}`}>
            {message.text}
          </p>
        ))}
      </div>
      <form className="side-chat-form" onSubmit={submit}>
        <label className="visually-hidden" htmlFor="chat-question">
          Question
        </label>
        <input
          id="chat-question"
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask about this window"
          autoComplete="off"
          disabled={!open}
        />
        <button type="submit" disabled={!open || !draft.trim()}>
          Ask
        </button>
      </form>
    </section>
  )
}
