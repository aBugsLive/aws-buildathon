import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import {
  parseAsOf,
  weekPairs,
  buildSeasonSql,
  buildLargestSql,
  summarizeYears,
  windowLabel,
} from '../src/seasonWindow.js'

test('parseAsOf accepts a real date and rejects a rollover', () => {
  const today = new Date(2024, 4, 9)
  const d = parseAsOf('2026-10-21', today)
  assert.equal(d.getFullYear(), 2026)
  assert.equal(d.getMonth(), 9)
  assert.equal(d.getDate(), 21)
  assert.equal(parseAsOf('2026-02-31', today).getMonth(), 4)
  assert.equal(parseAsOf(null, today).getDate(), 9)
})

test('week is the 7 calendar days ending on asOf, including a month boundary', () => {
  const october = weekPairs(parseAsOf('2026-10-21'))
  assert.equal(october.length, 7)
  assert.deepEqual(october[0], { month: 10, day: 15 })
  assert.deepEqual(october[6], { month: 10, day: 21 })

  const crossing = weekPairs(parseAsOf('2026-11-02'))
  assert.deepEqual(crossing[0], { month: 10, day: 27 })
  assert.deepEqual(crossing[6], { month: 11, day: 2 })
  assert.equal(windowLabel('week', parseAsOf('2026-11-02')), 'Oct 27–Nov 2')
  assert.equal(windowLabel('month', parseAsOf('2026-10-21')), 'October')
})

test('sqlite totals Northeast fires on those dates and ignores other regions', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE fires (
      objectid INTEGER PRIMARY KEY,
      acres_burned REAL,
      discovered_at INTEGER,
      region TEXT
    )
  `)
  const ms = (y, m, d) => Date.UTC(y, m - 1, d, 12, 0, 0)
  const insert = db.prepare(
    'INSERT INTO fires (objectid, acres_burned, discovered_at, region) VALUES (?, ?, ?, ?)',
  )
  insert.run(1, 10, ms(2017, 10, 16), 'NORTHEAST')
  insert.run(2, 5, ms(2017, 10, 21), 'NORTHEAST')
  insert.run(3, 100, ms(2013, 10, 15), 'NORTHEAST')
  insert.run(4, 1, ms(2017, 10, 14), 'NORTHEAST')
  insert.run(5, 50, ms(2017, 10, 16), 'SOUTHEAST')
  insert.run(6, 7, ms(2026, 10, 20), 'NORTHEAST')

  const asOf = parseAsOf('2026-10-21')
  const { sql, params } = buildSeasonSql('week', asOf)
  const rows = db.prepare(sql).all(params)
  const summary = summarizeYears(rows, 2026)

  assert.deepEqual(summary.thisYear, { year: 2026, fires: 1, acres: 7 })
  assert.deepEqual(summary.worstByFires, { year: 2017, fires: 2 })
  assert.deepEqual(summary.worstByAcres, { year: 2013, acres: 100 })
})

test('largest-by-acres query stays inside the Northeast window and this year', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE fires (
      objectid INTEGER PRIMARY KEY,
      incident_name TEXT,
      county TEXT,
      cause TEXT,
      acres_burned REAL,
      discovered_at INTEGER,
      region TEXT
    )
  `)
  const ms = (y, m, d) => Date.UTC(y, m - 1, d, 12, 0, 0)
  const insert = db.prepare(
    `INSERT INTO fires (objectid, incident_name, county, cause, acres_burned, discovered_at, region)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  insert.run(1, 'BIG-OLD', 'Ferry', 'Natural', 80, ms(2017, 10, 16), 'NORTHEAST')
  insert.run(2, 'THIS-YEAR', 'Stevens', 'Debris Burn', 9, ms(2026, 10, 18), 'NORTHEAST')
  insert.run(3, 'BIGGER', 'Pend Oreille', 'Natural', 12, ms(2026, 10, 21), 'NORTHEAST')
  insert.run(4, 'OUTSIDE', 'Spokane', 'Natural', 99, ms(2026, 10, 14), 'NORTHEAST')
  insert.run(5, 'OTHER-REGION', 'King', 'Natural', 500, ms(2026, 10, 18), 'SOUTHEAST')

  const query = buildLargestSql('week', parseAsOf('2026-10-21'))
  const largest = db.prepare(query.sql).get(query.params)
  assert.equal(largest.incident_name, 'BIGGER')
  assert.equal(largest.county, 'Pend Oreille')
  assert.equal(largest.acres_burned, 12)
})

test('this year is left out of the prior-year maxima', () => {
  const summary = summarizeYears(
    [
      { year: 2024, fires: 5, acres: 5 },
      { year: 2026, fires: 99, acres: 99 },
    ],
    2026,
  )
  assert.equal(summary.worstByFires.year, 2024)
  assert.equal(summary.worstByAcres.year, 2024)
})
