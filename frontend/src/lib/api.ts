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

async function inboxRequest(path: string, signal: AbortSignal): Promise<Response> {
  const response = await fetch(`/api/v1/inbox${path}`, { signal })
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null)
    throw new Error(data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string'
      ? data.detail : `Inbox request failed (${response.status}). Check the backend and Docker inbox service.`)
  }
  return response
}

export async function getInboxEmails(signal: AbortSignal): Promise<EmailRecord[]> {
  const data: unknown = await (await inboxRequest('/emails', signal)).json()
  if (Array.isArray(data) && data.length === 0) return []
  return parseEmails(data)
}

export async function getInboxEmail(id: string, signal: AbortSignal): Promise<EmailRecord> {
  const emails = parseEmails(await (await inboxRequest(`/emails/${encodeURIComponent(id)}`, signal)).json())
  if (emails.length !== 1 || emails[0].email_id !== id) throw new Error('Docker inbox returned a different email.')
  return emails[0]
}

export async function getInboxAttachment(id: string, path: string, signal: AbortSignal): Promise<Blob> {
  return (await inboxRequest(`/emails/${encodeURIComponent(id)}/attachments/${path.split('/').map(encodeURIComponent).join('/')}`, signal)).blob()
}

export const shipmentFields = [
  ['shipper', 'Shipper'], ['consignee', 'Consignee'], ['notify_party', 'Notify party'],
  ['port_of_loading', 'Port of loading'], ['port_of_discharge', 'Port of discharge'],
  ['container_count', 'Container count'], ['gross_weight_kg', 'Gross weight (kg)'],
] as const
export type ShipmentFieldName = typeof shipmentFields[number][0]
export interface DocumentExtraction {
  document_type: 'BL' | 'SI'
  attachments: string[]
  status: 'extracted' | 'needs_review' | 'error'
  fields: Record<ShipmentFieldName, { value: string | null; evidence: string | null }> | null
  warnings: string[]
  error: string | null
  source_text: string | null
}
export interface ExtractionResult { email: EmailRecord; bl: DocumentExtraction; si: DocumentExtraction }

async function extractionRequest(path: string, signal: AbortSignal, emailId?: string): Promise<unknown> {
  const response = await fetch(`/api/v1/debug/extraction${path}`, {
    signal, ...(emailId ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email_id: emailId }) } : {}),
  })
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string'
    ? data.detail : `Extraction request failed (${response.status}). Check the backend connection.`)
  return data
}

export async function getExtractionEmails(signal: AbortSignal): Promise<string[]> {
  const data = await extractionRequest('/emails', signal)
  if (!data || typeof data !== 'object' || !('email_ids' in data) || !Array.isArray(data.email_ids) ||
      !data.email_ids.every((id: unknown) => typeof id === 'string')) throw new Error('Invalid extraction email list.')
  return data.email_ids
}

export async function getExtractionEmail(id: string, signal: AbortSignal): Promise<EmailRecord> {
  const emails = parseEmails(await extractionRequest(`/emails/${encodeURIComponent(id)}`, signal))
  if (emails.length !== 1 || emails[0].email_id !== id) throw new Error('Unexpected extraction email.')
  return emails[0]
}

function isDocumentExtraction(data: unknown, kind: 'BL' | 'SI'): data is DocumentExtraction {
  if (!data || typeof data !== 'object') return false
  const doc = data as Record<string, unknown>
  if (doc.document_type !== kind || !['extracted', 'needs_review', 'error'].includes(String(doc.status)) ||
      !Array.isArray(doc.attachments) || !doc.attachments.every(path => typeof path === 'string') ||
      !Array.isArray(doc.warnings) || !doc.warnings.every(warning => typeof warning === 'string') ||
      !(doc.error === null || typeof doc.error === 'string') || !(doc.source_text === null || typeof doc.source_text === 'string')) return false
  if (doc.fields === null) return doc.status !== 'extracted'
  if (!doc.fields || typeof doc.fields !== 'object') return false
  return shipmentFields.every(([name]) => {
    const field = (doc.fields as Record<string, unknown>)[name]
    return !!field && typeof field === 'object' && 'value' in field && 'evidence' in field &&
      (field.value === null || typeof field.value === 'string') && (field.evidence === null || typeof field.evidence === 'string')
  })
}

function parseExtractionResult(data: unknown, id: string): ExtractionResult {
  if (!data || typeof data !== 'object' || !('email' in data) || !('bl' in data) || !('si' in data) ||
      !isDocumentExtraction(data.bl, 'BL') || !isDocumentExtraction(data.si, 'SI')) throw new Error('Invalid extraction response. Retry the request.')
  const emails = parseEmails(data.email)
  if (emails.length !== 1 || emails[0].email_id !== id) throw new Error('Unexpected extraction email.')
  return { email: emails[0], bl: data.bl, si: data.si }
}

export async function runExtraction(id: string, signal: AbortSignal): Promise<ExtractionResult> {
  return parseExtractionResult(await extractionRequest('', signal, id), id)
}

export async function runPipelineExtraction(id: string, signal: AbortSignal): Promise<ExtractionResult> {
  const response = await fetch('/api/v1/extract', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email_id: id }), signal,
  })
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string'
    ? data.detail : `Extraction request failed (${response.status}). Check Docker and the backend.`)
  return parseExtractionResult(data, id)
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

/** Accept the exact extraction download, or a batch of extraction responses. */
export function parseExtraction(value: unknown): ExtractionResult[] {
  const container = value && typeof value === 'object' && 'extractions' in value ? value.extractions : value
  const rows: unknown[] = Array.isArray(container) ? container : [container]
  if (!rows.length || rows.length > 520) throw new Error('Import between 1 and 520 extraction results.')
  const ids = new Set<string>()
  return rows.map(row => {
    if (!row || typeof row !== 'object' || !('email' in row)) throw new Error('Use extraction output containing email, bl, and si.')
    const email = parseEmails(row.email)[0]
    if (ids.has(email.email_id)) throw new Error(`Duplicate email: ${email.email_id}`)
    ids.add(email.email_id)
    return parseExtractionResult(row, email.email_id)
  })
}

export async function compareDocuments(extractions: ExtractionResult[], signal: AbortSignal): Promise<CompareResponse> {
  const response = await fetch('/api/v1/compare', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ extractions }), signal,
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
