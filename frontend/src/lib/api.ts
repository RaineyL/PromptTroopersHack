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
