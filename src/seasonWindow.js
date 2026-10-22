// How severe a calendar window has been in the Northeast, across every year
// the local DNR copy holds. This is a historical range for those dates.
// It is not how many acres one fire grew in a day.

const REGION = 'NORTHEAST'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/**
 * Parse YYYY-MM-DD into a local calendar date.
 * Falls back to today when the string is missing or not a real date.
 *
 * @param {string|null|undefined} raw
 * @param {Date} [today]
 * @returns {Date}
 */
export function parseAsOf(raw, today = new Date()) {
  if (typeof raw === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim())
    if (m) {
      const year = Number(m[1])
      const month = Number(m[2])
      const day = Number(m[3])
      const d = new Date(year, month - 1, day)
      if (
        d.getFullYear() === year &&
        d.getMonth() === month - 1 &&
        d.getDate() === day
      ) {
        return d
      }
    }
  }
  return new Date(today.getFullYear(), today.getMonth(), today.getDate())
}

/** @param {Date} d */
export function isoDate(d) {
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/**
 * The seven calendar days ending on asOf, inclusive.
 * @param {Date} asOf
 * @returns {Array<{ month: number, day: number }>} month is 1-12
 */
export function weekPairs(asOf) {
  const pairs = []
  for (let back = 6; back >= 0; back--) {
    const d = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate() - back)
    pairs.push({ month: d.getMonth() + 1, day: d.getDate() })
  }
  return pairs
}

/** Short label for the card subtitle. */
export function windowLabel(mode, asOf) {
  if (mode === 'month') return MONTHS[asOf.getMonth()]
  const pairs = weekPairs(asOf)
  const start = pairs[0]
  const end = pairs[pairs.length - 1]
  const startName = MONTHS[start.month - 1].slice(0, 3)
  const endName = MONTHS[end.month - 1].slice(0, 3)
  if (start.month === end.month) return `${startName} ${start.day}–${end.day}`
  return `${startName} ${start.day}–${endName} ${end.day}`
}

/**
 * SQL against the local `fires` table. Discovery timestamps are Pacific
 * midnight, which is still the same UTC calendar date, so unixepoch
 * month/day matches the date on the incident.
 *
 * @param {'week'|'month'} mode
 * @param {Date} asOf
 * @returns {{ sql: string, params: Object }}
 */
function windowFilter(mode, asOf) {
  const params = { region: REGION }
  let dateClause
  if (mode === 'month') {
    params.month = asOf.getMonth() + 1
    dateClause =
      "CAST(strftime('%m', discovered_at / 1000, 'unixepoch') AS INTEGER) = @month"
  } else {
    const parts = weekPairs(asOf).map((p, i) => {
      params[`m${i}`] = p.month
      params[`d${i}`] = p.day
      return (
        `(CAST(strftime('%m', discovered_at / 1000, 'unixepoch') AS INTEGER) = @m${i}` +
        ` AND CAST(strftime('%d', discovered_at / 1000, 'unixepoch') AS INTEGER) = @d${i})`
      )
    })
    dateClause = `(${parts.join(' OR ')})`
  }
  return { dateClause, params }
}

export function buildSeasonSql(mode, asOf) {
  const { dateClause, params } = windowFilter(mode, asOf)
  const sql = `
    SELECT CAST(strftime('%Y', discovered_at / 1000, 'unixepoch') AS INTEGER) AS year,
           COUNT(*) AS fires,
           COALESCE(SUM(acres_burned), 0) AS acres
    FROM fires
    WHERE region = @region
      AND discovered_at IS NOT NULL
      AND ${dateClause}
    GROUP BY year
    ORDER BY year
  `
  return { sql, params }
}

/** Largest fire by acres in the Northeast window for the asOf year. */
export function buildLargestSql(mode, asOf) {
  const { dateClause, params } = windowFilter(mode, asOf)
  params.year = asOf.getFullYear()
  const sql = `
    SELECT incident_name, county, cause, acres_burned, discovered_at
    FROM fires
    WHERE region = @region
      AND discovered_at IS NOT NULL
      AND CAST(strftime('%Y', discovered_at / 1000, 'unixepoch') AS INTEGER) = @year
      AND ${dateClause}
    ORDER BY acres_burned DESC, incident_name ASC
    LIMIT 1
  `
  return { sql, params }
}

/**
 * @param {Array<{ year: number, fires: number, acres: number }>} yearRows
 * @param {number} thisYear
 */
export function summarizeYears(yearRows, thisYear) {
  const rows = (yearRows || [])
    .map((r) => ({
      year: Number(r.year),
      fires: Number(r.fires) || 0,
      acres: Number(r.acres) || 0,
    }))
    .filter((r) => Number.isFinite(r.year))
    .sort((a, b) => a.year - b.year)

  const current = rows.find((r) => r.year === thisYear) || null
  const prior = rows.filter((r) => r.year !== thisYear)

  let worstByFires = null
  let worstByAcres = null
  for (const r of prior) {
    if (!worstByFires || r.fires > worstByFires.fires) {
      worstByFires = { year: r.year, fires: r.fires }
    }
    if (!worstByAcres || r.acres > worstByAcres.acres) {
      worstByAcres = { year: r.year, acres: r.acres }
    }
  }

  return {
    thisYear: current,
    worstByFires,
    worstByAcres,
    yearRows: rows,
  }
}
