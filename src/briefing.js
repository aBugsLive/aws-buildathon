// Sentences for the corner ghost and the side chat.
// Every number comes from the season query or the filtered dashboard summary.
// Nothing here divides acres by days or calls a fire "spreading".

function count(n) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function acres(n) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 })
}

function fireName(fire) {
  return fire?.incident_name || 'an unnamed fire'
}

function largestSentence(season) {
  const fire = season?.largestThisYear
  if (!fire) return null
  const where = fire.county ? ` in ${fire.county}` : ''
  return `Largest by acres in that window: ${fireName(fire)}${where}, ${acres(fire.acres_burned)} acres.`
}

/**
 * Lines the ghost reads on open. `windowText` is the calendar label
 * ("Oct 15–21" or "October").
 * @param {object|null} season
 * @param {string} windowText
 * @returns {string[]}
 */
export function buildBriefingLines(season, windowText) {
  if (!season) {
    return ['Checking the Northeast records for this part of the year.']
  }
  if (!season.databaseRows) {
    return ['The local database is empty. Run npm run sync to load the DNR records.']
  }

  const label = windowText || 'this window'
  const year = season.thisYear?.year || String(season.asOf || '').slice(0, 4)
  const lines = []

  if (season.thisYear) {
    lines.push(
      `Northeast, ${label}: ${count(season.thisYear.fires)} fires and ${acres(season.thisYear.acres)} acres in ${year}.`,
    )
  } else {
    lines.push(`The Northeast has no fires on record for ${label} in ${year}.`)
  }

  const largest = largestSentence(season)
  if (largest) lines.push(largest)

  if (season.worstByFires) {
    lines.push(
      `The most fires on these dates in a past year was ${count(season.worstByFires.fires)} in ${season.worstByFires.year}.`,
    )
  }
  if (season.worstByAcres) {
    lines.push(
      `The most acres on these dates in a past year was ${acres(season.worstByAcres.acres)} in ${season.worstByAcres.year}.`,
    )
  }

  lines.push(
    'This is the historical range for these dates, not how many acres a fire grew today.',
  )
  return lines
}

function noRows() {
  return 'The local database has no rows yet, so I cannot quote a count. Run npm run sync, then ask again.'
}

function rangeSentence(season, windowText) {
  return buildBriefingLines(season, windowText)
    .filter((line) => !line.startsWith('Checking'))
    .join(' ')
}

/**
 * Deterministic reply. The question is plain text. The reply uses only
 * `season` (Northeast calendar window) and `summary` (current page filters).
 */
export function answerQuestion(question, { season, summary, windowText } = {}) {
  const q = String(question || '').trim().toLowerCase()
  if (!q) return 'Ask about seasonal activity for this time of year, or which fire is largest by acres.'

  if (/spread|growing|growth|per day|acres\/day|daily|uncontained|containment/.test(q)) {
    return 'Day-by-day growth is not in this data. I can compare how many fires and acres the Northeast has seen on these same dates in past years.'
  }

  if (/help|what can you|what do you know/.test(q)) {
    return 'I can tell you the Northeast total for this week or month, the past year with the most fires, the past year with the most acres, and the largest fire by acres in that window. I can also read the county and cause charts for the filters on the page. I do not have day-by-day growth.'
  }

  if (!season || !season.databaseRows) {
    return noRows()
  }

  // The spread answer offers this comparison. "go ahead" should deliver it.
  if (
    /^(go ahead|yes|yeah|yep|sure|ok|okay|please|do it|do that|compare|show me|tell me|continue)\b/.test(q) ||
    /\b(go ahead|do that|do it|compare them)\b/.test(q)
  ) {
    return rangeSentence(season, windowText)
  }

  if (/prevent|resource|allocat|crew|send people/.test(q)) {
    const largest = largestSentence(season)
    const lead = largest
      ? `${largest} `
      : 'No Northeast fire is on record in that window. '
    return `${lead}This copy has no control date, so I cannot tell which fires are still open. These totals are not a forecast.`
  }

  if (/cause/.test(q) && /largest|worst|biggest/.test(q)) {
    const fire = season.largestThisYear
    if (!fire) return `No Northeast fire is on record for ${windowText || 'this window'}.`
    if (!fire.cause) return `${fireName(fire)} has no cause recorded.`
    return `${fireName(fire)} is recorded as ${fire.cause}. That is the cause on the row, not a judgment about who started it.`
  }

  if (/largest|worst|biggest/.test(q)) {
    const fire = season.largestThisYear
    if (!fire) {
      return `No Northeast fire is on record for ${windowText || 'this window'} in ${String(season.asOf || '').slice(0, 4)}.`
    }
    const where = fire.county ? `, ${fire.county}` : ''
    return `Largest by acres in the Northeast for ${windowText || 'this window'}: ${fireName(fire)}${where}, ${acres(fire.acres_burned)} acres. Largest means the most acres, not a separate severity score.`
  }

  if (/how bad|histor|past year|season|compared|severe|quiet|this week|this month|these dates/.test(q)) {
    return rangeSentence(season, windowText)
  }

  if (/county|counties/.test(q)) {
    const top = summary?.byCounty?.[0]
    if (!top) return 'The county chart has no rows for the current filters.'
    return `${top.name} has the most acres among fires matching the filters on the page: ${count(top.acres)} acres. That chart follows the filters. It is not limited to the Northeast date window.`
  }

  if (/cause/.test(q)) {
    const top = summary?.byCause?.[0]
    if (!top) return 'The cause chart has no rows for the current filters.'
    return `${top.name} is the most common recorded cause among fires matching the filters on the page: ${count(top.value)} fires. That chart follows the filters, not only the Northeast date window.`
  }

  if (/how many|total|acres/.test(q)) {
    if (!season.thisYear) {
      return `The Northeast has no fires on record for ${windowText || 'this window'}.`
    }
    return `Northeast, ${windowText || 'this window'}: ${count(season.thisYear.fires)} fires and ${acres(season.thisYear.acres)} acres in ${season.thisYear.year}.`
  }

  return 'I only answer from the numbers already loaded. Ask about seasonal activity for this time of year, which fire is largest by acres, or which county has the most acres in the current filters.'
}
