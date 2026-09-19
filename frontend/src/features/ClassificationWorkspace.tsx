import { useEffect, useRef, useState } from 'react'
import { categories, classifyEmail, parseEmails, type Category, type ClassificationResult, type EmailRecord } from '../lib/api'
import { Icon } from '../components/Icon'

const example = JSON.stringify({ email_id: 'demo_001', from: 'operations@example.com', subject: 'Please check draft BL', body: 'Please compare the attached draft BL with our shipping instructions and confirm the details.', attachments: ['demo_001_SI.txt', 'demo_001_BL.txt'] }, null, 2)
type Row = { email: EmailRecord; result?: ClassificationResult; error?: string; decision?: { category: Category; note: string } }
const label = (value: string) => value.replaceAll('_', ' ')

export function ClassificationWorkspace({ debug = false }: { debug?: boolean }) {
  const [input, setInput] = useState(example)
  const [inputSummary, setInputSummary] = useState('Sample loaded: demo_001. Replace it with your inbox records.')
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reviewOnly, setReviewOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [importing, setImporting] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; controller.current?.abort() }
  }, [])

  useEffect(() => {
    if (error) document.getElementById(debug ? 'debug-json-error' : 'pipeline-json-error')?.focus()
  }, [error, debug])

  async function process(emails: EmailRecord[], retry = false) {
    if (controller.current) return
    const abort = new AbortController()
    controller.current = abort
    setBusy(true)
    setError('')
    if (!retry) { setRows(emails.map(email => ({ email }))); setPage(0) }
    try {
      for (const email of emails) {
        if (abort.signal.aborted) break
        const timeout = window.setTimeout(() => abort.abort(), 390000)
        try {
          const result = await classifyEmail(email, abort.signal)
          if (mounted.current && !abort.signal.aborted) setRows(previous => previous.map(row => row.email.email_id === email.email_id ? { email, result } : row))
        } catch (cause) {
          if (mounted.current) setRows(previous => previous.map(row => row.email.email_id === email.email_id ? { ...row, error: abort.signal.aborted ? 'Stopped or timed out. Retry to classify this email.' : cause instanceof Error ? cause.message : 'Could not reach the backend.' } : row))
        } finally { window.clearTimeout(timeout) }
      }
    } finally {
      controller.current = null
      if (mounted.current) setBusy(false)
    }
  }

  function start() {
    try { void process(parseEmails(JSON.parse(input))) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid JSON.') }
  }

  async function importFiles(files: FileList | null) {
    if (!files) return
    setImporting(true)
    try {
      if (Array.from(files).reduce((total, file) => total + file.size, 0) > 10_000_000) throw new Error('Import size must be below 10 MB.')
      const records: EmailRecord[] = []
      for (const file of Array.from(files)) records.push(...parseEmails(JSON.parse(await file.text())))
      const emails = parseEmails(records)
      if (mounted.current) { setInput(JSON.stringify(emails, null, 2)); setInputSummary(`${emails.length} email record${emails.length === 1 ? '' : 's'} loaded from JSON files.`); setError('') }
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not read JSON files.') }
    finally { if (mounted.current) setImporting(false) }
  }

  function download() {
    const report = { workspace: debug ? 'debug' : 'pipeline', stage: 'email_classification', document_comparison_implemented: false, emails: rows.map(row => ({ ...row, effective_category: row.decision?.category ?? row.result?.classification.category ?? null, next_step: row.decision ? (row.decision.category === 'BL_COMPARISON' ? 'document_comparison_pending' : 'classification_complete') : row.result?.next_step ?? 'unprocessed', decided_by: row.decision ? 'human' : row.result ? 'llm' : null })) }
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = debug ? 'debug-classification-report.json' : 'pipeline-classification-report.json'; document.body.append(anchor); anchor.click(); anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const reviewCount = rows.filter(row => row.result?.classification.needs_human_review && !row.decision).length
  const filtered = rows.filter(row => (!reviewOnly || (row.result?.classification.needs_human_review && !row.decision)) && `${row.email.email_id} ${row.email.subject ?? ''}`.toLowerCase().includes(search.toLowerCase()))
  const pageCount = Math.max(1, Math.ceil(filtered.length / 20))
  const currentPage = Math.min(page, pageCount - 1)
  const shown = filtered.slice(currentPage * 20, currentPage * 20 + 20)
  const classified = rows.filter(row => row.result).length
  const pendingDocuments = rows.filter(row => (row.decision?.category ?? row.result?.classification.category) === 'BL_COMPARISON' && (row.decision || !row.result?.classification.needs_human_review)).length
  const inputId = debug ? 'debug-json' : 'pipeline-json'
  return (
    <div className="classification-workspace">
      {!debug && <div className="metrics" aria-label="Current session summary">
        <div><span>Emails in this run</span><strong>{rows.length.toString().padStart(2, '0')}</strong><small>Imported for classification</small></div>
        <div><span>Classified</span><strong>{classified.toString().padStart(2, '0')}</strong><small>Intent identified</small></div>
        <div><span>Human review</span><strong className={reviewCount ? 'amber-text' : ''}>{reviewCount.toString().padStart(2, '0')}</strong><small>Decisions needing attention</small></div>
        <div><span>Awaiting document check</span><strong>{pendingDocuments.toString().padStart(2, '0')}</strong><small>Extraction is not available yet</small></div>
      </div>}
      <section className="panel intake" aria-labelledby={`${inputId}-heading`}>
        <div className="section-heading"><div><p className="eyebrow">{debug ? 'Isolated stage test' : 'Start a workflow'}</p><h2 id={`${inputId}-heading`}>{debug ? 'Test email classification' : 'Bring your inbox into focus'}</h2></div><span className="badge blue">{debug ? 'POST /api/v1/classify' : 'JSON inbox records'}</span></div>
        <p>{debug ? 'Send email JSON directly to the classifier. Inspect its category, evidence, audit, and review decision below.' : 'Import shipping emails to identify the request and route the next action. Comparison requests will pause before document extraction.'}</p>
        <label className="upload-zone"><Icon name="upload"/><span><strong>Choose inbox files</strong><small>One or more JSON files · up to 520 emails · 10 MB total</small></span><input type="file" accept=".json,application/json" multiple disabled={busy || importing} onChange={event => void importFiles(event.target.files)} /></label>
        <p className="input-summary">{inputSummary}</p>
        <details className="json-editor" open={debug || undefined}>
          <summary>{debug ? 'Request body' : 'Or paste email JSON / view imported records'}</summary>
          <label htmlFor={inputId}>Email JSON</label><textarea id={inputId} value={input} disabled={busy || importing} onChange={event => { setInput(event.target.value); setInputSummary('Custom JSON input. Validated when you run classification.') }} spellCheck={false} aria-describedby={error ? `${inputId}-error` : undefined} />
        </details>
        {error && <p className="error" id={`${inputId}-error`} role="alert" tabIndex={-1}>{error}</p>}
        <div className="run-toolbar"><button disabled={busy || importing} onClick={start}><Icon name="play"/>{busy ? 'Classifying…' : debug ? 'Run classification test' : 'Run available stage'}</button>{busy && <button className="secondary" onClick={() => controller.current?.abort()}>Stop batch</button>}<span role="status">{importing ? 'Reading files…' : busy ? `Processing ${rows.filter(row => row.result || row.error).length} of ${rows.length} emails` : debug ? 'DeepSeek only · text and filename metadata' : 'Classification is ready. Later stages are coming next.'}</span></div>
      </section>
      <section aria-labelledby={`${inputId}-results`}>
        <div className="results-header"><div><p className="eyebrow">{debug ? 'Test output' : 'Current session'}</p><h2 id={`${inputId}-results`}>{debug ? 'Classification results' : 'Workflow queue'} <span className="count">{rows.length}</span></h2></div><button className="secondary" disabled={!rows.length || busy} onClick={download}><Icon name="download"/>Export results</button></div>
        <div className="queue-tools"><label className="search">Search emails<input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(0) }} placeholder="Search by subject or email ID" /></label><label className="filter"><input type="checkbox" checked={reviewOnly} onChange={event => { setReviewOnly(event.target.checked); setPage(0) }} /> Needs review ({reviewCount})</label></div>
        {!shown.length && <div className="empty"><Icon name="inbox"/><h3>{rows.length ? 'No matching emails' : 'Your workflow starts with an email'}</h3><p>{rows.length ? 'Change the search or review filter to see more results.' : 'Import your inbox records above, or run the sample email to try classification.'}</p><span>Classify → Extract → Compare → Report</span></div>}
        {shown.map(row => <article className="panel result-card" key={row.email.email_id}>
          <p className="eyebrow">{row.email.email_id}</p><h3>{row.email.subject || '(No subject)'}</h3>
          <details><summary>Email context and attachments</summary><p>From: {row.email.from || '(Not provided)'}</p><pre>{row.email.body}</pre><p>{row.email.attachments?.join(', ') || 'No attachments'}</p></details>
          {row.error && <p className="error" role="alert">{row.error}</p>}
          {!row.result && <button className="secondary" disabled={busy} onClick={() => void process([row.email], true)}>Retry classification</button>}
          {row.result && <>
            <div className="badges"><strong>{label(row.decision?.category ?? row.result.classification.category)}</strong></div>
            <p>{row.result.classification.rationale}</p>
            <ul>{row.result.classification.evidence.map((evidence, index) => <li key={index}>{evidence.source}: {evidence.signal}</li>)}</ul>
            {row.result.audit && <p>Second-pass audit: {label(row.result.audit.recommended_category)}. {row.result.audit.reason}</p>}
            {row.decision ? <p className="decision">Human confirmed: {label(row.decision.category)}. {row.decision.note}</p> : row.result.classification.needs_human_review && <Review row={row} onConfirm={(category, note) => setRows(previous => previous.map(item => item.email.email_id === row.email.email_id ? { ...item, decision: { category, note } } : item))} />}
            {debug && <details className="raw-response"><summary>Inspect raw API response</summary><pre>{JSON.stringify(row.result, null, 2)}</pre></details>}
            <p className="next-step">Next: {row.decision ? row.decision.category === 'BL_COMPARISON' ? 'Document comparison pending' : 'Classification complete' : label(row.result.next_step)}</p>
          </>}
        </article>)}
        {pageCount > 1 && <div className="pagination"><button className="secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {pageCount}</span><button className="secondary" disabled={currentPage + 1 === pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></div>}
        <p className="session-note"><Icon name="info"/>Session-only results. Export before leaving or starting a new run. No documents have been verified.</p>
      </section>
    </div>
  )
}

function Review({ row, onConfirm }: { row: Row; onConfirm: (category: Category, note: string) => void }) {
  const [category, setCategory] = useState<Category>(row.result!.classification.category)
  const [note, setNote] = useState('')
  return <form className="review" onSubmit={event => { event.preventDefault(); if (note.trim()) onConfirm(category, note.trim()) }}>
    <h4>Human review required</h4><p>{row.result!.classification.ambiguity_reason}</p><p>{row.result!.classification.question_for_user}</p>
    <label>Confirmed category<select value={category} onChange={event => setCategory(event.target.value as Category)}>{categories.map(item => <option key={item} value={item}>{label(item)}</option>)}</select></label>
    <label>Decision note<input value={note} required maxLength={2000} onChange={event => setNote(event.target.value)} placeholder="Explain the confirmed or corrected intent" /></label><button disabled={!note.trim()}>Confirm decision</button>
  </form>
}

