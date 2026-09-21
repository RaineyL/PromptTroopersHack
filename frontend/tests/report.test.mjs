import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSubmission, parseClassificationReport, parseComparisonReport } from '../src/lib/report.ts'
import { parseEmails } from '../src/lib/api.ts'

const classification = (email_id, category = 'BL_COMPARISON', needs_human_review = false) => ({ email_id, category, needs_human_review })
const compared = (email_id, status, defect_fields = [], review_fields = [], review_reason = null) => ({ email_id, status, defect_fields, review_fields, review_reason })
const snapshot = (results, decisions = {}) => ({ response: { results }, decisions })

test('submission maps classified email and compared BL fields to the sample format', () => {
  const { submission, issues } = buildSubmission([
    classification('email_001', 'GENERAL'),
    classification('email_004'),
    classification('email_501'),
  ], snapshot([
    compared('email_004', 'MISMATCH', ['consignee', 'notify_party']),
    compared('email_501', 'NEEDS_REVIEW', [], [], 'wrong_doc_type'),
  ]))
  assert.deepEqual(issues, [])
  assert.deepEqual(submission, {
    email_001: { category: 'GENERAL', status: 'OK', review_reason: null, defect_fields: [], has_defect: false },
    email_004: { category: 'BL_COMPARISON', status: 'MISMATCH', review_reason: null, defect_fields: ['consignee', 'notify_party'], has_defect: true },
    email_501: { category: 'BL_COMPARISON', status: 'NEEDS_REVIEW', review_reason: 'wrong_doc_type', defect_fields: [], has_defect: false },
  })
})

test('incomplete classification and missing comparison prevent a complete submission', () => {
  const { submission, issues } = buildSubmission([
    classification('email_001', null, true), classification('email_002'),
  ], null)
  assert.deepEqual(submission, {})
  assert.equal(issues.length, 2)
})

test('unresolved reviews export as explicit NEEDS_REVIEW without claiming a clean result', () => {
  const { submission, issues } = buildSubmission([
    classification('email_001', 'GENERAL', true),
    classification('email_002', 'BL_COMPARISON', true),
    classification('email_003'),
  ], snapshot([compared('email_003', 'NEEDS_REVIEW', [], ['shipper'], 'uncertain_value')]))
  assert.deepEqual(issues, [])
  assert.deepEqual(submission, Object.fromEntries(['email_001', 'email_002', 'email_003'].map(id => [id, {
    category: id === 'email_001' ? 'GENERAL' : 'BL_COMPARISON',
    status: 'NEEDS_REVIEW', review_reason: 'uncertain_value', defect_fields: [], has_defect: false,
  }])))
})

test('a confirmed defect outranks an unclear field and exports directly as MISMATCH', () => {
  const { submission, issues } = buildSubmission([
    classification('email_004'),
  ], snapshot([compared('email_004', 'MISMATCH', ['consignee'], ['shipper'], 'uncertain_value')]))
  assert.deepEqual(issues, [])
  assert.deepEqual(submission.email_004, {
    category: 'BL_COMPARISON',
    status: 'MISMATCH',
    review_reason: null,
    defect_fields: ['consignee'],
    has_defect: true,
  })
})

test('human comparison decisions override review status and require named mismatch fields', () => {
  const rows = [classification('email_003')]
  const comparison = compared('email_003', 'NEEDS_REVIEW', [], [], 'uncertain_value')
  let report = buildSubmission(rows, snapshot([comparison], { email_003: { status: 'MISMATCH', fields: [], note: 'Checked' } }))
  assert.equal(report.issues.length, 1)
  report = buildSubmission(rows, snapshot([comparison], { email_003: { status: 'MISMATCH', fields: ['shipper'], note: 'Checked' } }))
  assert.deepEqual(report.issues, [])
  assert.deepEqual(report.submission.email_003, { category: 'BL_COMPARISON', status: 'MISMATCH', review_reason: null, defect_fields: ['shipper'], has_defect: true })
})

test('a blocked comparison stays unresolved unless a human explicitly changes it', () => {
  const rows = [classification('email_004')]
  const blocked = compared('email_004', 'NEEDS_REVIEW', [], [], 'missing_attachment')
  const pending = buildSubmission(rows, snapshot([blocked]))
  assert.equal(pending.submission.email_004.status, 'NEEDS_REVIEW')
  assert.equal(pending.submission.email_004.review_reason, 'missing_attachment')
  const decided = buildSubmission(rows, snapshot([blocked], { email_004: { status: 'OK', fields: [], note: 'Verified source documents' } }))
  assert.deepEqual(decided.issues, [])
  assert.equal(decided.submission.email_004.status, 'OK')
  assert.equal(decided.submission.email_004.review_reason, null)

  const unable = buildSubmission(rows, snapshot([blocked], { email_004: { status: 'UNABLE_TO_VERIFY', fields: [], note: 'SI document missing', reasons: ['SI document missing'] } }))
  assert.deepEqual(unable.issues, [])
  assert.equal(unable.submission.email_004.status, 'NEEDS_REVIEW')
  assert.equal(unable.submission.email_004.review_reason, 'missing_attachment')
  assert.equal(unable.submission.email_004.has_defect, false)
})

test('debug stage reads existing classification and comparison exports', () => {
  const classifications = parseClassificationReport({ emails: [{ email: { email_id: 'email_004' }, result: { classification: { needs_human_review: false } }, effective_category: 'BL_COMPARISON' }] })
  const comparison = parseComparisonReport({ emails: [{ ...compared('email_004', 'MISMATCH', ['consignee']), human_decision: null }] })
  assert.deepEqual(buildSubmission(classifications, comparison).issues, [])
  assert.throws(() => parseClassificationReport({ emails: [{ email: { email_id: 'email_004' }, effective_category: 'INVALID' }] }), /Invalid email ID or category/)
  assert.throws(() => parseComparisonReport({ emails: [{ ...compared('email_004', 'MISMATCH', ['invalid']) }] }), /Invalid result/)
})

test('email intake and report accept more than 520 records', () => {
  const emails = Array.from({ length: 601 }, (_, index) => ({ email_id: `email_${index}`, body: 'Hello' }))
  assert.equal(parseEmails(emails).length, 601)
  const report = buildSubmission(emails.map(email => classification(email.email_id, 'GENERAL')), null)
  assert.equal(report.issues.length, 0)
  assert.equal(Object.keys(report.submission).length, 601)
})
