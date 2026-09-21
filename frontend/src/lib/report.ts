import { categories, checkedFields, type Category, type CheckedField, type ComparisonResult, type CompareResponse, type CompareStatus, type ReviewReason } from './api.ts'

export interface ReportClassification {
  email_id: string
  category: Category | null
  needs_human_review: boolean
}

export interface ReportDecision {
  status: 'OK' | 'MISMATCH' | 'UNABLE_TO_VERIFY'
  fields: CheckedField[]
  note: string
  reasons?: string[]
}

export interface ReportComparison {
  response: CompareResponse
  decisions: Record<string, ReportDecision>
}

export interface SubmissionRow {
  category: Category
  status: CompareStatus
  review_reason: ReviewReason | null
  defect_fields: CheckedField[]
  has_defect: boolean
}

export function buildSubmission(classifications: ReportClassification[], comparison: ReportComparison | null): {
  submission: Record<string, SubmissionRow>
  issues: string[]
} {
  const submission: Record<string, SubmissionRow> = {}
  const issues: string[] = []
  if (!classifications.length) issues.push('No classified emails are available.')
  const compared = new Map(comparison?.response.results.map(result => [result.email_id, result]) ?? [])
  const seen = new Set<string>()

  for (const item of classifications) {
    if (!item.email_id || seen.has(item.email_id)) {
      issues.push(`Duplicate or missing email ID: ${item.email_id || '(blank)'}.`)
      continue
    }
    seen.add(item.email_id)
    if (!item.category) {
      issues.push(`${item.email_id}: classification has no category. Retry this email before exporting.`)
      continue
    }
    if (item.needs_human_review) {
      // Preserve the model's provisional category without claiming a confirmed outcome.
      submission[item.email_id] = { category: item.category, status: 'NEEDS_REVIEW', review_reason: 'uncertain_value', defect_fields: [], has_defect: false }
      continue
    }
    if (item.category !== 'BL_COMPARISON') {
      submission[item.email_id] = { category: item.category, status: 'OK', review_reason: null, defect_fields: [], has_defect: false }
      continue
    }
    const result = compared.get(item.email_id)
    if (!result) {
      issues.push(`${item.email_id}: run SI/BL comparison before exporting.`)
      continue
    }
    const decision = comparison?.decisions[item.email_id]
    if (decision?.status === 'UNABLE_TO_VERIFY') {
      let mappedReason: ReviewReason = 'missing_attachment'
      const noteLower = (decision.note || '').toLowerCase()
      if (noteLower.includes('extraction') || noteLower.includes('unreadable')) {
        mappedReason = 'unreadable'
      } else if (noteLower.includes('multiple') || noteLower.includes('wrong')) {
        mappedReason = 'wrong_doc_type'
      } else if (noteLower.includes('missing')) {
        mappedReason = 'missing_attachment'
      } else {
        mappedReason = result.review_reason ?? 'missing_attachment'
      }
      submission[item.email_id] = {
        category: item.category,
        status: 'NEEDS_REVIEW',
        review_reason: mappedReason,
        defect_fields: [],
        has_defect: false,
      }
      continue
    }
    if (result.review_fields.length && !result.defect_fields.length && !decision) {
      // Only an unconfirmed review without any defect is exported as NEEDS_REVIEW.
      submission[item.email_id] = { category: item.category, status: 'NEEDS_REVIEW', review_reason: result.review_reason ?? 'uncertain_value', defect_fields: [], has_defect: false }
      continue
    }
    const status = decision?.status ?? result.status
    const defect_fields = status === 'MISMATCH' ? (decision?.fields ?? result.defect_fields) : []
    if (status === 'MISMATCH' && !defect_fields.length) {
      issues.push(`${item.email_id}: select at least one defective field for the mismatch.`)
      continue
    }
    submission[item.email_id] = {
      category: item.category,
      status,
      review_reason: status === 'NEEDS_REVIEW' ? result.review_reason ?? 'uncertain_value' : null,
      defect_fields: checkedFields.filter(field => defect_fields.includes(field)),
      has_defect: status === 'MISMATCH',
    }
  }
  return { submission, issues }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.')
  return value as Record<string, unknown>
}

/** Accept the classification export from this app's Classification stage. */
export function parseClassificationReport(value: unknown): ReportClassification[] {
  const rows = record(value).emails
  if (!Array.isArray(rows) || !rows.length) throw new Error('Classification export needs at least one email.')
  return rows.map(raw => {
    const row = record(raw)
    const email = record(row.email)
    const result = row.result ? record(row.result) : null
    const classification = result?.classification ? record(result.classification) : null
    const category = row.effective_category
    if (typeof email.email_id !== 'string' || !email.email_id.trim() ||
        (category !== null && category !== undefined && !categories.includes(category as Category))) {
      throw new Error('Invalid email ID or category in classification export.')
    }
    return {
      email_id: email.email_id,
      category: (category ?? null) as Category | null,
      needs_human_review: !result || (classification?.needs_human_review === true && !row.decision),
    }
  })
}

/** Accept the detailed export from this app's Comparison stage. */
export function parseComparisonReport(value: unknown): ReportComparison {
  const rows = record(value).emails
  if (!Array.isArray(rows)) throw new Error('Comparison export needs an emails array.')
  const decisions: Record<string, ReportDecision> = {}
  const results: ComparisonResult[] = rows.map(raw => {
    const row = record(raw)
    if (typeof row.email_id !== 'string' || !['OK', 'MISMATCH', 'NEEDS_REVIEW'].includes(String(row.status)) ||
        !Array.isArray(row.defect_fields) || !Array.isArray(row.review_fields) ||
        !row.defect_fields.every((field: unknown) => checkedFields.includes(field as CheckedField)) ||
        !row.review_fields.every((field: unknown) => checkedFields.includes(field as CheckedField))) {
      throw new Error('Invalid result in comparison export.')
    }
    if (row.human_decision) {
      const decision = record(row.human_decision)
      if (!['OK', 'MISMATCH', 'UNABLE_TO_VERIFY'].includes(String(decision.status)) || !Array.isArray(decision.fields) ||
          !decision.fields.every((field: unknown) => checkedFields.includes(field as CheckedField)) || typeof decision.note !== 'string' || !decision.note.trim()) {
        throw new Error('Invalid human decision in comparison export.')
      }
      decisions[row.email_id] = decision as unknown as ReportDecision
    }
    return row as unknown as ComparisonResult
  })
  return { response: { summary: { emails: results.length, ok: 0, mismatch: 0, needs_review: 0, defect_fields: {}, unpaired_files: [] }, results }, decisions }
}
