/**
 * A styled from/to date-range control with a clear button.
 *
 * @param {object} props
 * @param {string} props.startDate   YYYY-MM-DD or ''
 * @param {string} props.endDate     YYYY-MM-DD or ''
 * @param {string} [props.min]       earliest selectable date
 * @param {string} [props.max]       latest selectable date
 * @param {(v: string) => void} props.onStartChange
 * @param {(v: string) => void} props.onEndChange
 * @param {() => void} props.onClear
 */
export default function DateRangeField({
  startDate,
  endDate,
  min,
  max,
  onStartChange,
  onEndChange,
  onClear,
}) {
  const hasValue = Boolean(startDate || endDate)

  return (
    <div className="date-range">
      <span className="date-range-label">Date range</span>
      <div className="date-range-inputs">
        <input
          type="date"
          aria-label="From date"
          value={startDate}
          min={min}
          max={endDate || max}
          onChange={(e) => onStartChange(e.target.value)}
        />
        <span className="date-range-sep">→</span>
        <input
          type="date"
          aria-label="To date"
          value={endDate}
          min={startDate || min}
          max={max}
          onChange={(e) => onEndChange(e.target.value)}
        />
        {hasValue && (
          <button
            type="button"
            className="date-range-clear"
            onClick={onClear}
            aria-label="Clear date range"
          >
            ×
          </button>
        )}
      </div>
    </div>
  )
}
