import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBriefingLines, answerQuestion } from '../src/briefing.js'

const season = {
  databaseRows: 120,
  asOf: '2026-10-21',
  thisYear: { year: 2026, fires: 11, acres: 41.7 },
  worstByFires: { year: 2017, fires: 40 },
  worstByAcres: { year: 2013, acres: 47.5 },
  largestThisYear: {
    incident_name: 'WOOD',
    county: 'Spokane',
    cause: 'Undetermine',
    acres_burned: 33,
  },
}

const summary = {
  byCounty: [{ name: 'Okanogan', acres: 1200 }],
  byCause: [{ name: 'Natural', value: 8 }],
}

test('briefing quotes the window totals, the past peaks, and the largest fire', () => {
  const lines = buildBriefingLines(season, 'Oct 15–21')
  const text = lines.join(' ')
  assert.match(text, /11 fires/)
  assert.match(text, /41\.7 acres/)
  assert.match(text, /40/)
  assert.match(text, /2017/)
  assert.match(text, /47\.5/)
  assert.match(text, /2013/)
  assert.match(text, /WOOD/)
  assert.match(text, /Spokane/)
  assert.match(text, /Largest by acres/)
  assert.match(text, /not how many acres a fire grew today/)
  assert.doesNotMatch(text, /spread|per day|human-caused/i)
})

test('go ahead continues into the same-dates comparison', () => {
  const reply = answerQuestion('go ahead', {
    season,
    summary,
    windowText: 'Oct 15–21',
  })
  assert.match(reply, /11 fires/)
  assert.match(reply, /41\.7 acres/)
  assert.match(reply, /2017/)
  assert.match(reply, /2013/)
  assert.doesNotMatch(reply, /only answer from the numbers/i)
})

test('spread questions do not invent a growth rate', () => {
  const reply = answerQuestion('which fires are spreading most this week', {
    season,
    summary,
    windowText: 'Oct 15–21',
  })
  assert.match(reply, /not in this data/i)
  assert.doesNotMatch(reply, /\d/)
})

test('largest question names the fire and stays with acres', () => {
  const reply = answerQuestion('which fire is the worst this week', {
    season,
    summary,
    windowText: 'Oct 15–21',
  })
  assert.match(reply, /WOOD/)
  assert.match(reply, /Largest by acres/)
  assert.match(reply, /33/)
  assert.doesNotMatch(reply, /spread|uncontained/i)
})

test('cause of the largest fire is quoted as recorded', () => {
  const reply = answerQuestion('what caused the largest fire', {
    season,
    summary,
    windowText: 'Oct 15–21',
  })
  assert.match(reply, /Undetermine/)
  assert.doesNotMatch(reply, /human-caused/i)
})

test('county answer is labeled as the page filters', () => {
  const reply = answerQuestion('which county has the most acres', {
    season,
    summary,
    windowText: 'Oct 15–21',
  })
  assert.match(reply, /Okanogan/)
  assert.match(reply, /filters/)
})

test('an empty database does not invent a count', () => {
  const reply = answerQuestion('how bad is this week', {
    season: { databaseRows: 0 },
    windowText: 'Oct 15–21',
  })
  assert.match(reply, /no rows/i)
  assert.doesNotMatch(reply, /\d+ fires/)
})
