import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'
import { fetchOptions, fetchSummary, fetchFires, fetchSeason } from './api.js'
import FireMap from './FireMap.jsx'
import { parseAsOf, isoDate, windowLabel } from './seasonWindow.js'
import { buildBriefingLines } from './briefing.js'
import GhostBriefing from './GhostBriefing.jsx'
import MultiSelect from './components/MultiSelect.jsx'
import RangeSlider from './components/RangeSlider.jsx'
import DateRangeField from './components/DateRangeField.jsx'
import SideChat from './SideChat.jsx'

const CAUSE_COLORS = [
  '#e63946', '#f4a261', '#2a9d8f', '#457b9d', '#8338ec',
  '#ffb703', '#fb5607', '#3a86ff', '#6a994e', '#bc6c25',
]

function formatDate(ms) {
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatNumber(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function formatAcres(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 })
}

// Tooltip for the "Fires by cause" donut: name, count, and share of total.
function CauseTooltip({ active, payload, total }) {
  if (!active || !payload || !payload.length) return null
  const slice = payload[0]
  const value = slice.value || 0
  const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0'
  return (
    <div className="pie-tooltip">
      <span className="pie-tooltip-dot" style={{ background: slice.payload.fill }} />
      <span className="pie-tooltip-name">{slice.name}</span>
      <span className="pie-tooltip-value">
        {formatNumber(value)} fires · {pct}%
      </span>
    </div>
  )
}

export default function App() {
  const [options, setOptions] = useState({ counties: [], causes: [], years: [] })
  const [summary, setSummary] = useState(null)
  const [fires, setFires] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // filters — county/cause/protection are now multi-select (arrays).
  const [counties, setCounties] = useState([])
  const [causes, setCauses] = useState([])
  const [protections, setProtections] = useState([])
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [minAcres, setMinAcres] = useState(0)

  // The API takes comma-separated lists for the multi-value filters.
  const filters = useMemo(
    () => ({
      county: counties.length ? counties.join(',') : 'ALL',
      cause: causes.length ? causes.join(',') : 'ALL',
      protection: protections.length ? protections.join(',') : 'ALL',
      startDate,
      endDate,
      minAcres,
    }),
    [counties, causes, protections, startDate, endDate, minAcres],
  )

  // Historical same-dates card. Independent of the county/cause/year filters.
  const asOf = useMemo(
    () => parseAsOf(new URLSearchParams(window.location.search).get('asOf')),
    [],
  )
  const [windowMode, setWindowMode] = useState('week')
  const [season, setSeason] = useState(null)
  const [seasonError, setSeasonError] = useState(null)
  const [seasonLoading, setSeasonLoading] = useState(true)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatTalking, setChatTalking] = useState(false)
  const chatTalkTimer = useRef(null)

  // Load filter options once.
  useEffect(() => {
    fetchOptions()
      .then(setOptions)
      .catch((err) => setError(err.message))
  }, [])

  // Reload summary + table whenever filters change.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([fetchSummary(filters), fetchFires({ ...filters, limit: 100 })])
      .then(([s, f]) => {
        if (!cancelled) {
          setSummary(s)
          setFires(f)
          setError(null)
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [filters])

  useEffect(() => {
    let cancelled = false
    setSeasonLoading(true)
    fetchSeason({ mode: windowMode, asOf: isoDate(asOf) })
      .then((data) => {
        if (!cancelled) {
          setSeason(data)
          setSeasonError(null)
        }
      })
      .catch((err) => {
        if (!cancelled) setSeasonError(err.message)
      })
      .finally(() => {
        if (!cancelled) setSeasonLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [windowMode, asOf])

  const kpis = summary?.kpis
  const largest = summary?.largest
  const causeTotal = useMemo(
    () => (summary?.byCause || []).reduce((s, d) => s + (d.value || 0), 0),
    [summary],
  )
  const dateLabel = windowLabel(windowMode, asOf)
  const briefingLines = useMemo(() => {
    if (seasonError) {
      return ['The seasonal range did not load. Start the API with npm run server.']
    }
    if (seasonLoading && !season) {
      return ['Checking the Northeast records for this part of the year.']
    }
    return buildBriefingLines(season, dateLabel)
  }, [season, seasonError, seasonLoading, dateLabel])

  const closeChat = useCallback(() => setChatOpen(false), [])
  const pulseGhost = useCallback(() => {
    setChatTalking(true)
    clearTimeout(chatTalkTimer.current)
    chatTalkTimer.current = setTimeout(() => setChatTalking(false), 1400)
  }, [])

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>WA HeatMap</h1>
          <p className="subtitle">
            Washington State wildfire history, risk analysis, and prevention
            planning · data from the WA Department of Natural Resources
          </p>
        </div>
        <button
          type="button"
          className="chat-toggle"
          aria-expanded={chatOpen}
          aria-controls="side-chat"
          onClick={() => setChatOpen((open) => !open)}
        >
          {chatOpen ? 'Close chat' : 'Chat'}
        </button>
      </header>

      {error && (
        <div className="status error">
          Failed to load data: {error}. Is the API running (<code>npm run server</code>)?
        </div>
      )}

      <section className="filters">
        <MultiSelect
          label="County"
          allLabel="All counties"
          options={options.counties}
          selected={counties}
          onChange={setCounties}
        />

        <MultiSelect
          label="Cause"
          allLabel="All causes"
          options={options.causes}
          selected={causes}
          onChange={setCauses}
        />

        <MultiSelect
          label="Type"
          allLabel="All types"
          options={options.protections || []}
          selected={protections}
          onChange={setProtections}
        />

        <DateRangeField
          startDate={startDate}
          endDate={endDate}
          min={options.dateRange?.min}
          max={options.dateRange?.max}
          onStartChange={setStartDate}
          onEndChange={setEndDate}
          onClear={() => {
            setStartDate('')
            setEndDate('')
          }}
        />

        <RangeSlider
          label="Min acres burned"
          value={minAcres}
          min={0}
          max={1000}
          step={10}
          onChange={setMinAcres}
          format={(n) => formatNumber(n)}
        />
      </section>

      {loading && !summary && <div className="status">Loading wildfire data…</div>}

      {summary && (
        <>
          <section className="kpis">
            <div className="kpi">
              <span className="kpi-label">Incidents</span>
              <span className="kpi-value">{formatNumber(kpis.totalFires)}</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Total acres burned</span>
              <span className="kpi-value">{formatNumber(kpis.totalAcres)}</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Avg acres / fire</span>
              <span className="kpi-value">{formatNumber(kpis.avgAcres)}</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Largest fire</span>
              <span className="kpi-value small">{largest?.incident_name || '—'}</span>
              <span className="kpi-sub">
                {formatNumber(largest?.acres_burned)} acres
              </span>
            </div>
          </section>

          <section className="card map-card">
            <h2>Incident map</h2>
            <p className="map-hint">
              Each dot is a fire, colored by cause and sized by acres burned. Click a
              cluster to zoom in, or a dot for incident details.
            </p>
            <FireMap filters={filters} />
          </section>

          <section className="card season-card">
            <div className="season-head">
              <h2>Seasonal activity baseline</h2>
              <div className="segmented" role="tablist" aria-label="Window">
                <button
                  type="button"
                  role="tab"
                  aria-selected={windowMode === 'week'}
                  className={windowMode === 'week' ? 'active' : ''}
                  onClick={() => setWindowMode('week')}
                >
                  Week
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={windowMode === 'month'}
                  className={windowMode === 'month' ? 'active' : ''}
                  onClick={() => setWindowMode('month')}
                >
                  Month
                </button>
              </div>
            </div>
            <p className="season-sub">
              Northeast region · {windowLabel(windowMode, asOf)} · historical
              average across all years on record. As of {formatDate(asOf.getTime())}.
            </p>
            {seasonLoading && (
              <div className="status">Loading seasonal history…</div>
            )}
            {seasonError && (
              <div className="status error">
                Could not load the seasonal baseline: {seasonError}
              </div>
            )}
            {!seasonLoading && !seasonError && season?.databaseRows === 0 && (
              <div className="status">
                The local database is empty. Run <code>npm run sync</code> once
                to load the DNR records.
              </div>
            )}
            {!seasonLoading && !seasonError && season && season.databaseRows > 0 && (
              <>
                <div className="season-grid">
                  <div className="season-stat">
                    <span className="season-label">
                      This year ({asOf.getFullYear()})
                    </span>
                    <span className="season-value">
                      {season.thisYear
                        ? `${formatNumber(season.thisYear.fires)} fires`
                        : 'No fires on record'}
                    </span>
                    <span className="season-note">
                      {season.thisYear
                        ? `${formatAcres(season.thisYear.acres)} acres`
                        : 'for these calendar dates'}
                    </span>
                  </div>
                  <div className="season-stat">
                    <span className="season-label">Most fires in a past year</span>
                    <span className="season-value">
                      {season.worstByFires
                        ? `${formatNumber(season.worstByFires.fires)} fires`
                        : '—'}
                    </span>
                    <span className="season-note">
                      {season.worstByFires
                        ? `in ${season.worstByFires.year}`
                        : 'no prior years on record'}
                    </span>
                  </div>
                  <div className="season-stat">
                    <span className="season-label">Most acres in a past year</span>
                    <span className="season-value">
                      {season.worstByAcres
                        ? `${formatAcres(season.worstByAcres.acres)} acres`
                        : '—'}
                    </span>
                    <span className="season-note">
                      {season.worstByAcres
                        ? `in ${season.worstByAcres.year}`
                        : 'no prior years on record'}
                    </span>
                  </div>
                </div>
                <p className="season-explainer">
                  This is the historical range for these dates in the Northeast.
                  The year chart below is every fire in the current filters, not
                  this same-dates comparison.
                </p>
                <p className="season-muted">
                  Day-by-day growth is a later version. This card uses past years
                  of the same dates.
                </p>
              </>
            )}
          </section>

          <section className="charts">
            <div className="card">
              <h2>Top 10 counties by acres burned</h2>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={summary.byCounty} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickFormatter={formatNumber} />
                  <YAxis type="category" dataKey="name" width={90} />
                  <Tooltip formatter={(v) => `${formatNumber(v)} acres`} />
                  <Bar dataKey="acres" fill="#e63946" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="card">
              <h2>Fires by cause</h2>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={summary.byCause}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={62}
                    outerRadius={96}
                    paddingAngle={1.5}
                    stroke="var(--panel)"
                    strokeWidth={2}
                    isAnimationActive={false}
                  >
                    {summary.byCause.map((entry, i) => (
                      <Cell
                        key={entry.name}
                        fill={CAUSE_COLORS[i % CAUSE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<CauseTooltip total={causeTotal} />} />
                  <Legend
                    layout="vertical"
                    align="right"
                    verticalAlign="middle"
                    iconType="circle"
                    formatter={(value) => (
                      <span className="pie-legend-label">{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="card">
            <h2>Fires & acres burned by year</h2>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={summary.byYear} margin={{ left: 10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis tickFormatter={formatNumber} />
                <Tooltip formatter={(v) => formatNumber(v)} />
                <Legend />
                <Bar dataKey="acres" name="Acres burned" fill="#f4a261" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </section>

          <section className="card">
            <h2>Largest incidents (top 100 of filtered)</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Incident</th>
                    <th>County</th>
                    <th>Cause</th>
                    <th className="num">Acres</th>
                    <th>Discovered</th>
                    <th>Region</th>
                  </tr>
                </thead>
                <tbody>
                  {fires.map((r) => (
                    <tr key={r.objectid}>
                      <td>{r.incident_name || '—'}</td>
                      <td>{r.county || '—'}</td>
                      <td>{r.cause || '—'}</td>
                      <td className="num">{formatNumber(r.acres_burned)}</td>
                      <td>{formatDate(r.discovered_at)}</td>
                      <td>{r.region || '—'}</td>
                    </tr>
                  ))}
                  {fires.length === 0 && (
                    <tr>
                      <td colSpan="6" className="empty">
                        No incidents match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <footer className="footer">
        Source data: Washington State Department of Natural Resources — DNR Fire
        Statistics (2000–present), via the ArcGIS REST Feature Service. Base map
        tiles © Esri. For prevention planning and situational awareness; not for
        operational dispatch or emergency response.
      </footer>

      <GhostBriefing lines={briefingLines} extraTalking={chatTalking} />
      <SideChat
        open={chatOpen}
        onClose={closeChat}
        season={season}
        summary={summary}
        windowText={dateLabel}
        onReply={pulseGhost}
      />
    </div>
  )
}
