import { useEffect, useRef, useState } from 'react'
import { categories, classifyEmail, parseEmails, runPipelineExtraction, type Category, type ClassificationResult, type EmailRecord, type ExtractionResult } from '../lib/api'
import { DocumentPanel } from './ExtractionWorkspace'
import { InboxSource } from './InboxSource'
import { Icon } from '../components/Icon'
import type { ReportClassification } from '../lib/report'

const example = JSON.stringify({ email_id: 'demo_001', from: 'operations@example.com', subject: 'Please check draft BL', body: 'Please compare the attached draft BL with our shipping instructions and confirm the details.', attachments: ['demo_001_SI.txt', 'demo_001_BL.txt'] }, null, 2)
type Row = { email: EmailRecord; result?: ClassificationResult; error?: string; decision?: { category: Category; note: string }; extraction?: ExtractionResult; extractionError?: string }
const label = (value: string) => value.replaceAll('_', ' ')
function nextAction(row: Row, debug: boolean): string {
  if (row.extraction) return row.extraction.bl.status === 'extracted' && row.extraction.si.status === 'extracted' ? 'Document comparison pending' : 'Review extraction findings'
  if (row.extractionError) return 'Retry extraction'
  if (!row.result) return 'Retry classification'
  if (row.result.classification.needs_human_review && !row.decision) return 'Human review required'
  if ((row.decision?.category ?? row.result.classification.category) === 'BL_COMPARISON') return debug ? 'Document extraction pending' : 'Extract documents'
  return 'Classification complete'
}

export function ClassificationWorkspace({ debug = false, onExtractions, onSaveExtraction, onReportClassifications }: { debug?: boolean; onExtractions?: (results: ExtractionResult[]) => void; onSaveExtraction?: (result: ExtractionResult, source: 'Pipeline') => void; onReportClassifications?: (rows: ReportClassification[]) => void }) {
  const [input, setInput] = useState(debug ? example : '')
  const [inputSummary, setInputSummary] = useState(debug ? 'Sample loaded: demo_001. Replace it with Docker email or JSON.' : 'Load an email and its attachments from Docker to begin.')
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

  useEffect(() => {
    onExtractions?.(rows.flatMap(row => row.extraction ? [row.extraction] : []))
    onReportClassifications?.(rows.map(row => ({
      email_id: row.email.email_id,
      category: row.decision?.category ?? row.result?.classification.category ?? null,
      needs_human_review: !row.result || (row.result.classification.needs_human_review && !row.decision),
    })))
  }, [rows, onExtractions, onReportClassifications])

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
          if (!debug && result.classification.category === 'BL_COMPARISON' && !result.classification.needs_human_review && !abort.signal.aborted) {
            try {
              const extraction = await runPipelineExtraction(email.email_id, abort.signal)
              if (mounted.current && !abort.signal.aborted) {
                setRows(previous => previous.map(row => row.email.email_id === email.email_id ? { ...row, extraction, extractionError: undefined } : row))
                onSaveExtraction?.(extraction, 'Pipeline')
              }
            } catch (cause) {
              if (mounted.current) setRows(previous => previous.map(row => row.email.email_id === email.email_id ? { ...row, extractionError: abort.signal.aborted ? 'Stopped or timed out. Retry extraction.' : cause instanceof Error ? cause.message : 'Could not extract the documents.' } : row))
            }
          }
        } catch (cause) {
          if (mounted.current) setRows(previous => previous.map(row => row.email.email_id === email.email_id ? { ...row, error: abort.signal.aborted ? 'Stopped or timed out. Retry to classify this email.' : cause instanceof Error ? cause.message : 'Could not reach the backend.' } : row))
        } finally { window.clearTimeout(timeout) }
      }
    } finally {
      controller.current = null
      if (mounted.current) setBusy(false)
    }
  }

  async function extractForEmail(emailId: string) {
    if (controller.current || debug) return
    const abort = new AbortController()
    controller.current = abort
    setBusy(true)
    const timeout = window.setTimeout(() => abort.abort(), 120000)
    try {
      const extraction = await runPipelineExtraction(emailId, abort.signal)
      if (mounted.current && !abort.signal.aborted) {
        setRows(previous => previous.map(row => row.email.email_id === emailId ? { ...row, extraction, extractionError: undefined } : row))
        onSaveExtraction?.(extraction, 'Pipeline')
      }
    } catch (cause) {
      if (mounted.current) setRows(previous => previous.map(row => row.email.email_id === emailId ? { ...row, extractionError: abort.signal.aborted ? 'Stopped or timed out. Retry extraction.' : cause instanceof Error ? cause.message : 'Could not extract the documents.' } : row))
    } finally {
      window.clearTimeout(timeout)
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
    const report = { workspace: debug ? 'debug' : 'pipeline', stage: debug ? 'email_classification' : 'classify_and_extract', document_comparison_implemented: true, emails: rows.map(row => ({ ...row, effective_category: row.decision?.category ?? row.result?.classification.category ?? null, decided_by: row.decision ? 'human' : row.result ? 'llm' : null })) }
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
  const readyForComparison = rows.filter(row => row.extraction?.bl.status === 'extracted' && row.extraction?.si.status === 'extracted').length
  const inputId = debug ? 'debug-json' : 'pipeline-json'
  return (
    <div className="classification-workspace">
      {!debug && <div className="metrics" aria-label="Current session summary">
        <div><span>Emails in this run</span><strong>{rows.length.toString().padStart(2, '0')}</strong><small>Imported for classification</small></div>
        <div><span>Classified</span><strong>{classified.toString().padStart(2, '0')}</strong><small>Intent identified</small></div>
        <div><span>Human review</span><strong className={reviewCount ? 'amber-text' : ''}>{reviewCount.toString().padStart(2, '0')}</strong><small>Decisions needing attention</small></div>
        <div><span>Awaiting comparison</span><strong>{readyForComparison.toString().padStart(2, '0')}</strong><small>Both documents extracted</small></div>
      </div>}
      <section className="panel intake" aria-labelledby={`${inputId}-heading`}>
        <div className="section-heading"><div><p className="eyebrow">{debug ? 'Isolated stage test' : 'Start a workflow'}</p><h2 id={`${inputId}-heading`}>{debug ? 'Test email classification' : 'Bring your inbox into focus'}</h2></div><span className="badge blue">{debug ? 'POST /api/v1/classify' : 'Docker inbox'}</span></div>
        <p>{debug ? 'Send email JSON directly to the classifier. Inspect its category, evidence, audit, and review decision below.' : 'Request shipping emails and attachments from Docker to identify the request and route the next action. Comparison requests continue to BL and SI extraction; run comparison below once extraction finishes.'}</p>
        <InboxSource onBusy={setImporting} debug={debug} disabled={busy || importing} onLoad={email => { setInput(JSON.stringify(email, null, 2)); setInputSummary(`${email.email_id} loaded from Docker.`); setError('') }} />
        {debug && <label className="upload-zone"><Icon name="upload"/><span><strong>Choose inbox files</strong><small>One or more JSON files · 10 MB total</small></span><input type="file" accept=".json,application/json" multiple disabled={busy || importing} onChange={event => void importFiles(event.target.files)} /></label>}
        <p className="input-summary">{inputSummary}</p>
        <details className="json-editor" open={debug || undefined}>
          <summary>{debug ? 'Request body' : 'View requested email JSON'}</summary>
          <label htmlFor={inputId}>Email JSON</label><textarea id={inputId} value={input} readOnly={!debug} disabled={busy || importing} onChange={event => { setInput(event.target.value); setInputSummary('Custom JSON input. Validated when you run classification.') }} spellCheck={false} aria-describedby={error ? `${inputId}-error` : undefined} />
        </details>
        {error && <p className="error" id={`${inputId}-error`} role="alert" tabIndex={-1}>{error}</p>}
        <div className="run-toolbar"><button disabled={busy || importing || !input} onClick={start}><Icon name="play"/>{busy ? 'Processing…' : debug ? 'Run classification test' : 'Run pipeline'}</button>{busy && <button className="secondary" onClick={() => controller.current?.abort()}>Stop batch</button>}<span role="status">{importing ? 'Loading email data…' : busy ? `Processing ${rows.filter(row => row.result || row.error).length} of ${rows.length} emails` : debug ? 'DeepSeek only · text and filename metadata' : 'Classification and extraction are ready. Compare extracted results below.'}</span></div>
      </section>
      <section aria-labelledby={`${inputId}-results`}>
        <div className="results-header"><div><p className="eyebrow">{debug ? 'Test output' : 'Current session'}</p><h2 id={`${inputId}-results`}>{debug ? 'Classification results' : 'Workflow queue'} <span className="count">{rows.length}</span></h2></div><button className="secondary" disabled={!rows.length || busy} onClick={download}><Icon name="download"/>Export results</button></div>
        <div className="queue-tools"><label className="search">Search emails<input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(0) }} placeholder="Search by subject or email ID" /></label><label className="filter"><input type="checkbox" checked={reviewOnly} onChange={event => { setReviewOnly(event.target.checked); setPage(0) }} /> Needs review ({reviewCount})</label></div>
        {!shown.length && <div className="empty"><Icon name="inbox"/><h3>{rows.length ? 'No matching emails' : 'Your workflow starts with an email'}</h3><p>{rows.length ? 'Change the search or review filter to see more results.' : 'Request an email and its attachments from Docker above to begin.'}</p><span>Classify → Extract → Compare → Report</span></div>}
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
            {row.decision ? <p className="decision">Human confirmed: {label(row.decision.category)}. {row.decision.note}</p> : row.result.classification.needs_human_review && <Review row={row} disabled={busy} onConfirm={(category, note) => { setRows(previous => previous.map(item => item.email.email_id === row.email.email_id ? { ...item, decision: { category, note } } : item)); if (!debug && category === 'BL_COMPARISON') void extractForEmail(row.email.email_id) }} />}
            {debug && <details className="raw-response"><summary>Inspect raw API response</summary><pre>{JSON.stringify(row.result, null, 2)}</pre></details>}
            {!debug && row.extractionError && <p className="error" role="alert">Extraction: {row.extractionError}</p>}
            {!debug && (row.decision?.category ?? row.result.classification.category) === 'BL_COMPARISON' && (row.decision || !row.result.classification.needs_human_review) && !row.extraction && <button className="secondary" disabled={busy} onClick={() => void extractForEmail(row.email.email_id)}>Retry extraction</button>}
            {!debug && row.extraction && <div className="extraction-pair"><DocumentPanel kind="BL" result={row.extraction.bl}/><DocumentPanel kind="SI" result={row.extraction.si}/></div>}
            <p className="next-step">Next: {nextAction(row, debug)}</p>
          </>}
        </article>)}
        {pageCount > 1 && <div className="pagination"><button className="secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {pageCount}</span><button className="secondary" disabled={currentPage + 1 === pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></div>}
        <p className="session-note"><Icon name="info"/>{debug ? 'Session-only classification results. Export before leaving.' : 'Session-only results. Export before leaving or starting a new run. Comparison results are shown and exported separately below.'}</p>
      </section>
    </div>
  )
}

function Review({ row, disabled, onConfirm }: { row: Row; disabled: boolean; onConfirm: (category: Category, note: string) => void }) {
  const [category, setCategory] = useState<Category>(row.result!.classification.category)
  const [note, setNote] = useState('')
  return <form className="review" onSubmit={event => { event.preventDefault(); if (note.trim()) onConfirm(category, note.trim()) }}>
    <h4>Human review required</h4><p>{row.result!.classification.ambiguity_reason}</p><p>{row.result!.classification.question_for_user}</p>
    <label>Confirmed category<select value={category} onChange={event => setCategory(event.target.value as Category)}>{categories.map(item => <option key={item} value={item}>{label(item)}</option>)}</select></label>
    <label>Decision note<input value={note} required maxLength={2000} onChange={event => setNote(event.target.value)} placeholder="Explain the confirmed or corrected intent" /></label><button disabled={disabled || !note.trim()}>Confirm decision</button>
  </form>
}
