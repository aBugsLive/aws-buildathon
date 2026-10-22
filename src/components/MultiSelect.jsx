import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * A checkable multi-select dropdown with search, select-all, and chip summary.
 *
 * @param {object} props
 * @param {string} props.label           field label
 * @param {string[]} props.options       available option values
 * @param {string[]} props.selected      currently selected values
 * @param {(next: string[]) => void} props.onChange
 * @param {string} [props.allLabel]      text shown when nothing is selected
 */
export default function MultiSelect({
  label,
  options,
  selected,
  onChange,
  allLabel = 'All',
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const rootRef = useRef(null)

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.toLowerCase().includes(q))
  }, [options, search])

  const selectedSet = useMemo(() => new Set(selected), [selected])
  const allSelected = selected.length === 0

  const toggle = (value) => {
    if (selectedSet.has(value)) {
      onChange(selected.filter((v) => v !== value))
    } else {
      onChange([...selected, value])
    }
  }

  const summary = allSelected
    ? allLabel
    : selected.length === 1
      ? selected[0]
      : `${selected.length} selected`

  return (
    <div className="ms" ref={rootRef}>
      <span className="ms-label">{label}</span>
      <button
        type="button"
        className={`ms-control ${open ? 'open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`ms-summary ${allSelected ? 'muted' : ''}`}>{summary}</span>
        <span className="ms-caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="ms-panel" role="listbox" aria-multiselectable="true">
          <div className="ms-search-row">
            <input
              className="ms-search"
              type="text"
              placeholder={`Search ${label.toLowerCase()}…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>

          <div className="ms-actions">
            <button type="button" onClick={() => onChange([])}>
              Select all
            </button>
            <button
              type="button"
              disabled={allSelected}
              onClick={() => onChange([])}
            >
              Clear
            </button>
          </div>

          <ul className="ms-list">
            {filtered.length === 0 && <li className="ms-empty">No matches</li>}
            {filtered.map((opt) => {
              const checked = selectedSet.has(opt)
              return (
                <li key={opt}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={checked}
                    className={`ms-option ${checked ? 'selected' : ''}`}
                    onClick={() => toggle(opt)}
                  >
                    <span>{opt}</span>
                    {checked && <span className="ms-check" aria-hidden="true">✓</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Chips for the current selection. */}
      {!allSelected && (
        <div className="ms-chips">
          {selected.map((v) => (
            <span key={v} className="ms-chip">
              {v}
              <button
                type="button"
                aria-label={`Remove ${v}`}
                onClick={() => toggle(v)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
