import { useEffect, useMemo, useRef, useState } from 'react'
import { categories, checkedFields, classifyEmail, compareDocuments, fieldTitles, getInboxAttachment, runPipelineExtraction, uploadInbox, type Category, type CheckedField, type ClassificationResult, type ComparisonResult, type EmailRecord, type ExtractionResult } from '../lib/api'
import { buildSubmission, type ReportClassification, type ReportComparison, type ReportDecision } from '../lib/report'
import { Icon } from '../components/Icon'

type Row = { email: EmailRecord; classification?: ClassificationResult; extraction?: ExtractionResult; comparison?: ComparisonResult; categoryDecision?: { category: Category; note: string }; comparisonDecision?: ReportDecision; error?: string; processing?: boolean }
const readable = (value: string) => value.replaceAll('_', ' ')
const PAGE_SIZE = 100
const comparisonNeedsDecision = (row: Row) => !!(row.comparison && !row.comparisonDecision && (row.comparison.status === 'NEEDS_REVIEW' || row.comparison.review_fields.length > 0))
const needsReview = (row: Row) => !!(row.classification?.classification.needs_human_review && !row.categoryDecision || comparisonNeedsDecision(row))

export function PipelineDashboard({ onSaveExtraction }: { onSaveExtraction: (result: ExtractionResult, source: 'Pipeline') => void }) {
  const [rows, setRows] = useState<Row[]>([])
  const [sessionId, setSessionId] = useState('')
  const [filename, setFilename] = useState('')
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Category | 'ALL'>('ALL')
  const [reviewOnly, setReviewOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [reviewCategory, setReviewCategory] = useState<Category>('GENERAL')
  const [reviewNote, setReviewNote] = useState('')
  const [reviewStatus, setReviewStatus] = useState<'' | 'OK' | 'MISMATCH'>('')
  const [reviewFields, setReviewFields] = useState<CheckedField[]>([])
  const [comparisonNote, setComparisonNote] = useState('')
  const [editingComparison, setEditingComparison] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const rowsRef = useRef(rows)
  useEffect(() => { rowsRef.current = rows }, [rows])
  useEffect(() => () => controller.current?.abort(), [])

  const changeRows = (update: (rows: Row[]) => Row[]) => setRows(previous => {
    const next = update(previous)
    rowsRef.current = next
    return next
  })
  const updateRow = (id: string, update: (row: Row) => Row) => changeRows(previous => previous.map(row => row.email.email_id === id ? update(row) : row))

  async function load(file: File | undefined) {
    if (!file || running || loading) return
    if (!/\.zip$/i.test(file.name) || file.size > 50_000_000) { setError('Choose a ZIP file no larger than 50 MB.'); return }
    const abort = new AbortController()
    controller.current = abort
    setLoading(true); setError('')
    try {
      const uploaded = await uploadInbox(file, abort.signal, sessionId)
      setSessionId(uploaded.sessionId); setFilename(file.name)
      changeRows(() => uploaded.emails.map(email => ({ email })))
      setSelected(null); setTexts({}); setFilter('ALL'); setReviewOnly(false); setSearch(''); setPage(0); setEditingComparison(false)
    } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not upload ZIP.') }
    finally { controller.current = null; setLoading(false) }
  }

  async function processRow(email: EmailRecord, signal: AbortSignal) {
    const id = email.email_id
    updateRow(id, row => ({ ...row, processing: true, error: undefined }))
    try {
      let row = rowsRef.current.find(item => item.email.email_id === id)!
      if (!row.classification) {
        const classification = await classifyEmail(email, signal, sessionId)
        updateRow(id, item => ({ ...item, classification }))
        row = { ...row, classification }
      }
      const category = row.categoryDecision?.category ?? row.classification!.classification.category
      if (row.classification!.classification.needs_human_review && !row.categoryDecision) return
      if (category !== 'BL_COMPARISON' || row.comparison) return
      const extraction = row.extraction ?? await runPipelineExtraction(id, signal, sessionId)
      if (!row.extraction) {
        updateRow(id, item => ({ ...item, extraction }))
        onSaveExtraction(extraction, 'Pipeline')
      }
      const comparison = (await compareDocuments([extraction], signal)).results[0]
      if (!comparison || comparison.email_id !== id) throw new Error('Comparison returned an unexpected email.')
      updateRow(id, item => ({ ...item, comparison }))
    } catch (cause) {
      if (!signal.aborted) updateRow(id, item => ({ ...item, error: cause instanceof Error ? cause.message : 'Processing failed.' }))
    } finally { updateRow(id, item => ({ ...item, processing: false })) }
  }

  async function run(emailId?: string) {
    if (controller.current || !sessionId) return
    const abort = new AbortController()
    controller.current = abort; setRunning(true); setError('')
    try {
      const queue = emailId ? rowsRef.current.filter(row => row.email.email_id === emailId) : rowsRef.current
      for (const row of queue) {
        if (abort.signal.aborted) break
        if (!row.comparison && (!row.classification || row.categoryDecision || !row.classification.classification.needs_human_review)) {
          await processRow(row.email, abort.signal)
        }
      }
    } finally { controller.current = null; setRunning(false) }
  }

  const active = rows.find(row => row.email.email_id === selected)
  const selectedEmail = active?.email
  useEffect(() => {
    if (!selectedEmail || !sessionId) return
    const txtPaths = (selectedEmail.attachments ?? []).filter(path => /\.txt$/i.test(path))
    const abort = new AbortController()
    void Promise.all(txtPaths.map(async path => {
      try {
        const blob = await getInboxAttachment(selectedEmail.email_id, path, abort.signal, sessionId)
        if (blob.size > 2_000_000) throw new Error('Text preview exceeds 2 MB.')
        const content = await blob.text()
        if (!abort.signal.aborted) setTexts(previous => ({ ...previous, [path]: content }))
      } catch (cause) {
        if (!abort.signal.aborted) setTexts(previous => ({ ...previous, [path]: cause instanceof Error ? cause.message : 'Preview unavailable.' }))
      }
    }))
    return () => abort.abort()
  }, [sessionId, selectedEmail])

  const classifications: ReportClassification[] = rows.map(row => ({ email_id: row.email.email_id, category: row.categoryDecision?.category ?? row.classification?.classification.category ?? null, needs_human_review: !row.classification || (row.classification.classification.needs_human_review && !row.categoryDecision) }))
  const comparison: ReportComparison = { response: { summary: { emails: 0, ok: 0, mismatch: 0, needs_review: 0, defect_fields: {}, unpaired_files: [] }, results: rows.flatMap(row => row.comparison ? [row.comparison] : []) }, decisions: Object.fromEntries(rows.flatMap(row => row.comparisonDecision ? [[row.email.email_id, row.comparisonDecision]] : [])) }
  const report = buildSubmission(classifications, comparison)
  const visible = useMemo(() => rows.filter(row => (!reviewOnly || needsReview(row)) && (filter === 'ALL' || (row.categoryDecision?.category ?? row.classification?.classification.category) === filter) && `${row.email.email_id} ${row.email.subject ?? ''} ${row.email.from ?? ''}`.toLowerCase().includes(search.toLowerCase())), [rows, filter, reviewOnly, search])
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const shown = visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
  const completed = Object.keys(report.submission).length
  const reviewCount = rows.filter(needsReview).length
  const reportReviewCount = Object.values(report.submission).filter(item => item.status === 'NEEDS_REVIEW').length

  function exportReport() {
    if (report.issues.length || running || loading) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(report.submission, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'submission.json'; document.body.append(link); link.click(); link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <div className="pipeline-dashboard">
    <section className="panel pipeline-intake">
      <div><p className="eyebrow">01 · Intake</p><h2>Upload your shipment inbox</h2><p>Choose one ZIP containing <code>inbox/*.json</code> and <code>attachments/</code>. The archive stays in this backend session for up to four hours.</p></div>
      <label className="upload-zone"><Icon name="upload"/><span><strong>{filename || 'Choose a ZIP bundle'}</strong><small>ZIP · 50 MB compressed maximum · no email-count limit</small></span><input type="file" accept=".zip,application/zip" disabled={loading || running} onChange={event => { void load(event.target.files?.[0]); event.target.value = '' }} /></label>
      <div className="pipeline-actions"><button disabled={!rows.length || loading || running} onClick={() => void run()}><Icon name="play"/>{running ? 'Running pipeline…' : 'Run pipeline'}</button>{running && <button className="secondary" onClick={() => controller.current?.abort()}>Stop</button>}<button className="secondary" disabled={!rows.length || !!report.issues.length || loading || running} onClick={exportReport}><Icon name="download"/>Export JSON report</button></div>
      {error && <p className="error" role="alert">{error}</p>}
      <p className="pipeline-help" role="status">{loading ? 'Validating ZIP…' : running ? `Processing: ${rows.filter(row => row.classification || row.error).length} of ${rows.length} classified` : rows.length ? `${rows.length} emails loaded from ${filename}. ${completed} report entries available${reportReviewCount ? `, including ${reportReviewCount} requiring a human decision` : ''}.` : 'Upload a bundle to begin. Classification uses the configured DeepSeek API.'}</p>
    </section>

    <div className="pipeline-stats" aria-label="Run summary"><div><span>Emails</span><strong>{rows.length}</strong></div><div><span>Classified</span><strong>{rows.filter(row => row.classification).length}</strong></div><div><span>Human decision required</span><strong>{reviewCount}</strong></div><div><span>Report entries</span><strong>{completed}/{rows.length}</strong></div></div>

    <section className="panel pipeline-results"><div className="section-heading"><div><p className="eyebrow">02 · Results</p><h2>Email queue</h2></div><span className="subtle">Classify → Extract → Compare → Report</span></div>
      <div className="pipeline-filters"><label>Search<input type="search" value={search} placeholder="Subject, sender or ID" onChange={event => { setSearch(event.target.value); setPage(0) }}/></label><label>Category<select value={filter} onChange={event => { setFilter(event.target.value as Category | 'ALL'); setPage(0) }}><option value="ALL">All categories</option>{categories.map(category => <option key={category} value={category}>{readable(category)}</option>)}</select></label><button className="secondary" aria-pressed={reviewOnly} onClick={() => { setReviewOnly(!reviewOnly); setFilter('ALL'); setSearch(''); setPage(0) }}>{reviewOnly ? 'Show all emails' : `Human decision required (${reviewCount})`}</button></div>
      <div className="pipeline-table-wrap"><table className="pipeline-table"><thead><tr><th>Email</th><th>Category</th><th>Outcome</th><th>Attachments</th><th>Action</th></tr></thead><tbody>{shown.map(row => {
        const category = row.categoryDecision?.category ?? row.classification?.classification.category
        const outcome = row.error ? 'Failed' : row.processing ? 'Processing' : !row.classification ? 'Not started' : needsReview(row) ? 'Human Decision Required' : category === 'BL_COMPARISON' ? row.comparisonDecision?.status ?? row.comparison?.status ?? 'Pending comparison' : 'OK'
        return <tr key={row.email.email_id} className={selected === row.email.email_id ? 'is-selected' : ''}><td data-label="Email"><button className="row-link" onClick={() => { setSelected(row.email.email_id); setTexts({}); setReviewCategory(category ?? 'GENERAL'); setReviewNote(''); setComparisonNote(row.comparisonDecision?.note ?? ''); setReviewStatus(row.comparisonDecision?.status ?? ''); setReviewFields(row.comparisonDecision?.fields ?? []); setEditingComparison(false) }} aria-label={`View ${row.email.email_id}: ${row.email.subject || 'No subject'}`}><strong>{row.email.subject || '(No subject)'}</strong><small>{row.email.email_id} · {row.email.from || 'Unknown sender'}</small></button></td><td data-label="Category">{category ? readable(category) : '—'}</td><td data-label="Outcome"><span className={`outcome ${outcome === 'Human Decision Required' || outcome === 'Failed' ? 'attention' : ''}`}>{outcome}</span></td><td data-label="Attachments">{row.email.attachments?.length ?? 0}</td><td data-label="Action">{row.error && <button className="secondary" disabled={running} onClick={() => void run(row.email.email_id)}>Retry</button>}</td></tr>
      })}</tbody></table></div>{!visible.length && <p className="pipeline-empty">{rows.length ? 'No emails match this filter.' : 'Your results will appear here after a ZIP is uploaded.'}</p>}
      {pageCount > 1 && <div className="pagination"><button className="secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {pageCount} · {visible.length} emails</span><button className="secondary" disabled={currentPage + 1 === pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></div>}
      {rows.length > 0 && report.issues.length > 0 && !running && <p className="pipeline-help">Export waits for a category and comparison result for every email. {report.issues.length} item{report.issues.length === 1 ? '' : 's'} still need processing.</p>}
    </section>

    {active && <section className="panel pipeline-detail" aria-labelledby="email-detail-heading"><div className="section-heading"><div><p className="eyebrow">03 · Email detail · {active.email.email_id}</p><h2 id="email-detail-heading">{active.email.subject || '(No subject)'}</h2></div><button className="secondary" onClick={() => setSelected(null)} aria-label="Close email detail">Close</button></div>
      <p className="pipeline-from">From {active.email.from || '(not provided)'}</p><h3>Message</h3><pre>{active.email.body}</pre>
      <h3>Attachments ({active.email.attachments?.length ?? 0})</h3>{active.email.attachments?.length ? <div className="attachment-list">{active.email.attachments.map(path => <div key={path}><strong>{path.split('/').at(-1)}</strong><code>{path}</code>{/\.txt$/i.test(path) && <pre className="attachment-preview">{texts[path] ?? 'Loading text…'}</pre>}</div>)}</div> : <p>No attachments.</p>}
      {active.error && <p className="error" role="alert">{active.error} <button className="secondary" disabled={running} onClick={() => void run(active.email.email_id)}>Retry email</button></p>}
      {active.classification && <div className="pipeline-finding"><h3>Classification · {readable(active.categoryDecision?.category ?? active.classification.classification.category)}</h3><p>{active.classification.classification.rationale}</p><ul>{active.classification.classification.evidence.map((evidence, index) => <li key={index}>{evidence.source}: {evidence.signal}</li>)}</ul>
        {active.classification.classification.needs_human_review && !active.categoryDecision && <form className="review" onSubmit={event => { event.preventDefault(); if (!reviewNote.trim()) return; updateRow(active.email.email_id, row => ({ ...row, categoryDecision: { category: reviewCategory, note: reviewNote.trim() }, extraction: undefined, comparison: undefined, comparisonDecision: undefined, error: undefined })); setReviewNote('') }}><h3>Confirm category</h3><p>{active.classification.classification.ambiguity_reason || active.classification.classification.question_for_user || 'Confirm the correct category to continue.'}</p><label>Category<select value={reviewCategory} onChange={event => setReviewCategory(event.target.value as Category)}>{categories.map(category => <option key={category}>{category}</option>)}</select></label><label>Decision note<input required value={reviewNote} onChange={event => setReviewNote(event.target.value)}/></label><button disabled={running || !reviewNote.trim()}>Confirm category</button></form>}
        {active.categoryDecision && <p className="decision">Confirmed by reviewer: {readable(active.categoryDecision.category)} · {active.categoryDecision.note}</p>}
        {active.categoryDecision?.category === 'BL_COMPARISON' && !active.comparison && !active.processing && <button className="secondary" disabled={running} onClick={() => void run(active.email.email_id)}>Continue extraction and comparison</button>}
      </div>}
      {active.extraction && <div className="pipeline-finding"><h3>Extraction</h3><p>BL: {active.extraction.bl.status} · SI: {active.extraction.si.status}</p>{[active.extraction.bl, active.extraction.si].map(doc => <div key={doc.document_type}><strong>{doc.document_type}</strong>{doc.warnings.map((warning, index) => <p key={index}>{warning}</p>)}{doc.error && <p className="error">{doc.error}</p>}</div>)}</div>}
      {active.comparison && <div className="pipeline-finding"><h3>Comparison · {comparisonNeedsDecision(active) ? 'Human Decision Required' : active.comparisonDecision?.status ?? active.comparison.status}</h3>{active.comparison.review_detail && <p>{active.comparison.review_detail}</p>}{active.comparison.fields.length > 0 && <div className="field-list">{active.comparison.fields.map(field => <div key={field.field}><strong>{fieldTitles[field.field]}</strong><span>{field.status}</span><small>SI: {field.si_value || '—'} · BL: {field.bl_value || '—'}</small></div>)}</div>}
        {(comparisonNeedsDecision(active) || editingComparison) && <form className="review" onSubmit={event => { event.preventDefault(); if (!reviewStatus || !comparisonNote.trim() || reviewStatus === 'MISMATCH' && !reviewFields.length) return; updateRow(active.email.email_id, row => ({ ...row, comparisonDecision: { status: reviewStatus, fields: reviewStatus === 'MISMATCH' ? reviewFields : [], note: comparisonNote.trim() } })); setEditingComparison(false) }}><h3>Human decision</h3><p>Optional: leave this unresolved to export it as NEEDS_REVIEW. Record a decision only after checking the source documents.</p><label>Decision<select value={reviewStatus} required onChange={event => setReviewStatus(event.target.value as '' | 'OK' | 'MISMATCH')}><option value="">Choose a decision</option><option value="OK">OK — verified no defect</option><option value="MISMATCH">MISMATCH — confirmed defect</option></select></label>{reviewStatus === 'MISMATCH' && <fieldset><legend>Defective fields</legend>{checkedFields.map(field => <label key={field}><input type="checkbox" checked={reviewFields.includes(field)} onChange={event => setReviewFields(previous => event.target.checked ? [...previous, field] : previous.filter(item => item !== field))}/>{fieldTitles[field]}</label>)}</fieldset>}<label>Decision note<input required value={comparisonNote} onChange={event => setComparisonNote(event.target.value)} placeholder="Explain what you verified"/></label><div className="pipeline-actions"><button disabled={!reviewStatus || !comparisonNote.trim() || reviewStatus === 'MISMATCH' && !reviewFields.length}>Save human decision</button>{editingComparison && <button type="button" className="secondary" onClick={() => setEditingComparison(false)}>Cancel</button>}</div></form>}
        {active.comparisonDecision && !editingComparison && <div className="decision"><p>Human decision: {active.comparisonDecision.status} · {active.comparisonDecision.note}</p><button className="secondary" onClick={() => { setReviewStatus(active.comparisonDecision!.status); setReviewFields(active.comparisonDecision!.fields); setComparisonNote(active.comparisonDecision!.note); setEditingComparison(true) }}>Change decision</button><button className="secondary" onClick={() => { updateRow(active.email.email_id, row => ({ ...row, comparisonDecision: undefined })); setReviewStatus(''); setReviewFields([]); setComparisonNote('') }}>Return to human decision required</button></div>}
      </div>}
    </section>}
  </div>
}
