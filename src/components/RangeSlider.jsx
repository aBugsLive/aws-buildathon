/**
 * A styled single-value range slider with a label and a live value bubble
 * positioned over the thumb.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {number} props.value
 * @param {number} props.min
 * @param {number} props.max
 * @param {number} [props.step]
 * @param {(n: number) => void} props.onChange
 * @param {(n: number) => string} [props.format]  value formatter for the bubble
 */
export default function RangeSlider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format = (n) => String(n),
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0

  return (
    <div className="range-field">
      <div className="range-top">
        <span className="range-label">{label}</span>
        <span className="range-value">{format(value)}</span>
      </div>
      <div className="range-track-wrap">
        <div className="range-fill" style={{ width: `${pct}%` }} />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ '--pct': `${pct}%` }}
        />
      </div>
    </div>
  )
}
