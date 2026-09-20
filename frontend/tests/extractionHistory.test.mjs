import assert from 'node:assert/strict'
import test from 'node:test'
import { loadExtractionHistory, rememberExtraction, saveExtractionHistory } from '../src/lib/extractionHistory.ts'

function result(id = 'email_001') {
  const doc = kind => ({ document_type: kind, attachments: [], status: 'needs_review', fields: null,
    warnings: ['Missing attachment'], error: null, source_text: 'Original evidence' })
  return { email: { email_id: id, body: 'Compare documents' }, bl: doc('BL'), si: doc('SI') }
}
function storage() {
  let value = null
  return { getItem: () => value, setItem: (_key, text) => { value = text } }
}

test('saved extraction survives reload with warnings and evidence intact', () => {
  const disk = storage()
  const entries = rememberExtraction([], result(), 'Extraction Debug')
  assert.equal(saveExtractionHistory(disk, entries).warning, '')
  assert.deepEqual(loadExtractionHistory(disk).entries, entries)
})
test('re-extraction replaces the same email but preserves other workspace snapshots', () => {
  let entries = rememberExtraction([], result(), 'Pipeline')
  entries = rememberExtraction(entries, result(), 'Extraction Debug')
  const updated = result(); updated.bl.source_text = 'Updated evidence'
  entries = rememberExtraction(entries, updated, 'Pipeline')
  assert.equal(entries.length, 2)
  assert.equal(entries[0].result.bl.source_text, 'Updated evidence')
  assert.equal(entries[1].result.bl.source_text, 'Original evidence')
  updated.bl.source_text = 'Changed after saving'
  assert.equal(entries[0].result.bl.source_text, 'Updated evidence')
})
test('history keeps only the latest 20 emails', () => {
  let entries = []
  for (let i = 0; i < 25; i++) entries = rememberExtraction(entries, result(`email_${i}`), 'Pipeline')
  assert.equal(entries.length, 20)
  assert.equal(entries[0].result.email.email_id, 'email_24')
  assert.equal(entries[19].result.email.email_id, 'email_5')
})
test('corrupt or invalid stored results are reported without crashing', () => {
  for (const value of ['{', '{}', JSON.stringify([{ id: 'x', source: 'Pipeline', savedAt: 'today', result: {} }])]) {
    const loaded = loadExtractionHistory({ getItem: () => value })
    assert.equal(loaded.entries.length, 0)
    assert.ok(loaded.warning)
  }
})
test('storage failure keeps usable session results and reports lack of persistence', () => {
  const entries = rememberExtraction([], result(), 'Pipeline')
  const saved = saveExtractionHistory({ setItem: () => { throw new Error('Quota exceeded') } }, entries)
  assert.deepEqual(saved.entries, entries)
  assert.match(saved.warning, /session only/)
})
