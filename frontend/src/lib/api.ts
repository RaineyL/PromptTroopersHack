export interface HealthResponse {
  status: 'ok'
  service: string
}

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch('/api/v1/health', { signal })
  if (!response.ok) {
    throw new Error(`API request failed (${response.status})`)
  }
  const data: unknown = await response.json()
  if (
    typeof data !== 'object' || data === null ||
    !('status' in data) || data.status !== 'ok' ||
    !('service' in data) || typeof data.service !== 'string'
  ) {
    throw new Error('Unexpected health response from the API')
  }
  return { status: data.status, service: data.service }
}

export const categories = ['BL_COMPARISON', 'SI_REQUEST', 'INVOICE_QUERY', 'GENERAL', 'SPAM'] as const
export type Category = typeof categories[number]
export interface EmailRecord {
  email_id: string
  from?: string
  subject?: string
  body: string
  attachments?: string[]
}
export interface ClassificationResult {
  email_id: string
  classification: {
    category: Category
    needs_human_review: boolean
    rationale: string
    evidence: { source: string; signal: string }[]
    competing_category: Category | null
    ambiguity_reason: string | null
    question_for_user: string | null
  }
  audit: { recommended_category: Category; reason: string; needs_human_review: boolean } | null
  audit_risk_flags: string[]
  next_step: 'human_review' | 'document_comparison_pending' | 'classification_complete'
}

export function parseEmails(value: unknown): EmailRecord[] {
  const rows: unknown[] = Array.isArray(value) ? value : [value]
  if (!rows.length || rows.length > 520) throw new Error('Import between 1 and 520 email records.')
  const ids = new Set<string>()
  return rows.map((row) => {
    if (typeof row !== 'object' || row === null || !('email_id' in row) ||
        typeof row.email_id !== 'string' || !row.email_id.trim() || row.email_id.length > 200 ||
        !('body' in row) || typeof row.body !== 'string' || !row.body.trim() || row.body.length > 100000) {
      throw new Error('Each email needs an email_id and a non-empty body (up to 100,000 characters).')
    }
    if (ids.has(row.email_id.trim())) throw new Error(`Duplicate email_id: ${row.email_id}`)
    ids.add(row.email_id.trim())
    for (const key of ['subject', 'from'] as const) {
      if (key in row && typeof (row as Record<string, unknown>)[key] !== 'string') throw new Error(`${key} must be text.`)
    }
    if ('attachments' in row && (!Array.isArray(row.attachments) || !row.attachments.every((item: unknown) => typeof item === 'string'))) {
      throw new Error('attachments must be a list of filenames.')
    }
    return row as EmailRecord
  })
}

export async function classifyEmail(email: EmailRecord, signal: AbortSignal): Promise<ClassificationResult> {
  const response = await fetch('/api/v1/classify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }), signal,
  })
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null)
    const message = data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string'
      ? data.detail : `Request failed (${response.status}). Check the email format and backend connection.`
    throw new Error(message)
  }
  const data: ClassificationResult = await response.json()
  if (data.email_id !== email.email_id.trim() || !data.classification ||
      !categories.includes(data.classification.category) ||
      typeof data.classification.needs_human_review !== 'boolean' || !Array.isArray(data.classification.evidence)) {
    throw new Error('Unexpected classification response. Retry this email.')
  }
  return data
}

/* ------------------------------------------------------------------ *
 * Stage 3 — SI versus draft BL comparison
 * ------------------------------------------------------------------ */

export const checkedFields = ['shipper', 'consignee', 'notify_party', 'port_of_loading', 'port_of_discharge', 'container_count', 'gross_weight_kg'] as const
export type CheckedField = typeof checkedFields[number]
export type FieldStatus = 'match' | 'mismatch' | 'review'
export type CompareStatus = 'OK' | 'MISMATCH' | 'NEEDS_REVIEW'
export type ReviewReason = 'missing_attachment' | 'wrong_doc_type' | 'unreadable' | 'missing_value' | 'uncertain_value'

export const fieldTitles: Record<CheckedField, string> = {
  shipper: 'Shipper', consignee: 'Consignee', notify_party: 'Notify party',
  port_of_loading: 'Port of loading', port_of_discharge: 'Port of discharge',
  container_count: 'Container count', gross_weight_kg: 'Gross weight (kg)',
}

export const reviewReasons: Record<ReviewReason, string> = {
  missing_attachment: 'An expected document was not attached to the email.',
  wrong_doc_type: 'An attachment is not the document it is named as.',
  unreadable: 'A document could not be read, so nothing in it was checked.',
  missing_value: 'A value the check needs is blank or a placeholder.',
  uncertain_value: 'The two values are too close to call automatically.',
}

export interface ExtractedDocument {
  file: string
  status?: string
  flag_reason?: string | null
  fields?: Record<string, unknown>
  raw_text?: string
}

export interface FieldComparison {
  field: CheckedField
  status: FieldStatus
  si_label: string | null
  si_value: string
  bl_label: string | null
  bl_value: string
  reason: string
  similarity: number | null
}

export interface ComparisonResult {
  email_id: string
  status: CompareStatus
  review_reason: ReviewReason | null
  review_detail: string | null
  has_defect: boolean
  defect_fields: CheckedField[]
  review_fields: CheckedField[]
  si_document: string | null
  bl_document: string | null
  fields: FieldComparison[]
}

export interface CompareResponse {
  summary: {
    emails: number
    ok: number
    mismatch: number
    needs_review: number
    defect_fields: Record<string, number>
    unpaired_files: string[]
  }
  results: ComparisonResult[]
}

/** Accepts the extraction stage's own output file, a bare array, or one document. */
export function parseExtraction(value: unknown): ExtractedDocument[] {
  const container = value && typeof value === 'object' && !Array.isArray(value) && 'documents' in value
    ? (value as { documents: unknown }).documents : value
  const rows: unknown[] = Array.isArray(container) ? container : [container]
  if (!rows.length || rows.length > 1200) throw new Error('Import between 1 and 1200 extracted documents.')

  const documents = rows.map((row) => {
    if (typeof row !== 'object' || row === null || !('file' in row) || typeof row.file !== 'string' || !row.file.trim()) {
      throw new Error('Each extracted document needs a "file" name, such as email_004_SI.txt.')
    }
    if (!/_(SI|BL)\.[A-Za-z0-9]+$/i.test(row.file.trim())) {
      throw new Error(`Cannot tell which document "${row.file}" is. File names must end in _SI or _BL plus an extension.`)
    }
    return row as ExtractedDocument
  })

  const paired = new Set(documents.map(item => item.file.replace(/_(SI|BL)\.[A-Za-z0-9]+$/i, '')))
  if (!paired.size) throw new Error('No email could be identified from these file names.')
  return documents
}

export async function compareDocuments(documents: ExtractedDocument[], signal: AbortSignal): Promise<CompareResponse> {
  const response = await fetch('/api/v1/compare', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documents }), signal,
  })
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null)
    const message = data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string'
      ? data.detail : `Comparison failed (${response.status}). Check the extraction file and the backend connection.`
    throw new Error(message)
  }
  const data: CompareResponse = await response.json()
  if (!data.summary || !Array.isArray(data.results)) throw new Error('Unexpected comparison response. Run the comparison again.')
  return data
}
