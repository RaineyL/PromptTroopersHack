import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReportHistory, rememberReportRun, saveReportHistory } from '../src/lib/reportHistory.ts'

const classification = id => JSON.stringify({ emails: [{ email: { email_id: id }, result: { classification: { needs_human_review: false } }, effective_category: 'GENERAL' }] })
const comparison = () => JSON.stringify({ emails: [] })
const disk = () => {
  let value = null
  return { getItem: () => value, setItem: (_key, text) => { value = text } }
}

test('each numbered run persists both exports under one index', () => {
  const storage = disk()
  let history = loadReportHistory(storage)
  history = saveReportHistory(storage, rememberReportRun(history, classification('email_001'), comparison(), '2026-09-20T01:00:00Z'))
  history = saveReportHistory(storage, rememberReportRun(history, classification('email_002'), comparison(), '2026-09-20T02:00:00Z'))
  const reloaded = loadReportHistory(storage)
  assert.equal(reloaded.nextId, 3)
  assert.deepEqual(reloaded.runs.map(run => run.id), [2, 1])
  assert.deepEqual(JSON.parse(reloaded.runs[1].classificationJson).emails[0].email.email_id, 'email_001')
  assert.deepEqual(JSON.parse(reloaded.runs[1].comparisonJson), { emails: [] })
})

test('report history retains the newest 20 paired runs without reusing numbers', () => {
  let history = { runs: [], nextId: 1, warning: '' }
  for (let id = 1; id <= 22; id++) history = rememberReportRun(history, classification(`email_${id}`), comparison())
  assert.equal(history.runs.length, 20)
  assert.deepEqual([history.runs[0].id, history.runs.at(-1).id, history.nextId], [22, 3, 23])
})

test('corrupt saved pairs are rejected and storage failures keep this session usable', () => {
  const invalid = { getItem: () => JSON.stringify({ nextId: 2, runs: [{ id: 1, savedAt: '2026-09-20', classificationJson: '{}', comparisonJson: comparison() }] }) }
  const loaded = loadReportHistory(invalid)
  assert.deepEqual(loaded.runs, [])
  assert.ok(loaded.warning)
  const next = rememberReportRun(loaded, classification('email_001'), comparison())
  const saved = saveReportHistory({ setItem: () => { throw new Error('Quota exceeded') } }, next)
  assert.equal(saved.runs[0].id, 1)
  assert.match(saved.warning, /session only/)
})
