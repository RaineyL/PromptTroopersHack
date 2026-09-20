import { useEffect, useRef, useState } from 'react'
import {
  checkedFields, compareDocuments, fieldTitles, parseExtraction, reviewReasons,
  type CheckedField, type ComparisonResult, type CompareResponse, type CompareStatus,
  type ExtractionResult, type FieldStatus,
} from '../lib/api'
import type { SavedExtraction } from '../lib/extractionHistory'
import type { ReportComparison, ReportDecision } from '../lib/report'
import { Icon } from '../components/Icon'

/** A reviewer's resolution of a case the rules refused to decide. */
type Decision = ReportDecision
type Filter = 'all' | 'MISMATCH' | 'NEEDS_REVIEW' | 'OK'

const PAGE_SIZE = 20

const sampleFields = {
  shipper: 'ACME EXPORTS LTD', consignee: 'EAST BRIGHT LTD', notify_party: 'EAST BRIGHT LTD',
  port_of_loading: 'NANTONG, CHINA', port_of_discharge: 'KARACHI, PAKISTAN', container_count: '6', gross_weight_kg: '131058',
}
const sampleDocument = (kind: 'SI' | 'BL'): ExtractionResult['si'] => ({
  document_type: kind, attachments: [`demo_001_${kind}.txt`], status: 'extracted', warnings: [], error: null, source_text: null,
  fields: Object.fromEntries(checkedFields.map(field => [field, {
    value: kind === 'BL' && field === 'container_count' ? '5' : sampleFields[field], evidence: null,
  }])) as ExtractionResult['si']['fields'],
})
const example: ExtractionResult = {
  email: { email_id: 'demo_001', body: 'Compare the attached SI and BL.' },
  si: sampleDocument('SI'), bl: sampleDocument('BL'),
}

/** Status is never carried by colour alone: every badge pairs a mark with a word. */
function StatusBadge({ status, decided = false }: { status: CompareStatus; decided?: boolean }) {
  const shown = { OK: ['green', 'check', 'No mismatch'], MISMATCH: ['red', 'info', 'Mismatch'], NEEDS_REVIEW: ['amber', 'info', 'Needs review'] } as const
  const [tone, icon, text] = shown[status]
  return <span className={`badge ${tone}`}><Icon name={icon} />{text}{decided ? ' · confirmed' : ''}</span>
}

function FieldBadge({ status }: { status: FieldStatus }) {
  const shown = { match: ['green', 'check', 'Match'], mismatch: ['red', 'info', 'Mismatch'], review: ['amber', 'info', 'Review'] } as const
  const [tone, icon, text] = shown[status]
  return <span className={`badge ${tone}`}><Icon name={icon} />{text}</span>
}

export function ComparisonWorkspace({ debug = false, extractions = [], savedExtractions = [], storageWarning = '', onReportComparison }: { debug?: boolean; extractions?: ExtractionResult[]; savedExtractions?: SavedExtraction[]; storageWarning?: string; onReportComparison?: (snapshot: ReportComparison | null) => void }) {
  const [savedId, setSavedId] = useState('')
  const selectedSaved = savedExtractions.find(entry => entry.id === savedId) ?? savedExtractions[0]
  const [input, setInput] = useState(() => JSON.stringify(example, null, 2))
  const [inputSummary, setInputSummary] = useState('Sample loaded: one SI and one draft BL with a changed container count.')
  const [response, setResponse] = useState<CompareResponse | null>(null)
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [openEmail, setOpenEmail] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const prefix = debug ? 'debug-compare' : 'pipeline-compare'

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; controller.current?.abort() }
  }, [])
  useEffect(() => { if (error) document.getElementById(`${prefix}-error`)?.focus() }, [error, prefix])
  useEffect(() => { onReportComparison?.(response ? { response, decisions } : null) }, [response, decisions, onReportComparison])

  async function run(documents: ExtractionResult[]) {
    if (controller.current) return
    const abort = new AbortController()
    controller.current = abort
    setBusy(true); setError('')
    const timeout = window.setTimeout(() => abort.abort(), 120000)
    try {
      const result = await compareDocuments(documents, abort.signal)
      if (mounted.current && !abort.signal.aborted) { setResponse(result); setDecisions({}); setPage(0); setOpenEmail(result.results[0]?.email_id ?? null) }
    } catch (cause) {
      if (mounted.current) setError(abort.signal.aborted ? 'Comparison was stopped or timed out. Run it again.' : cause instanceof Error ? cause.message : 'Could not reach the backend.')
    } finally {
      window.clearTimeout(timeout); controller.current = null
      if (mounted.current) setBusy(false)
    }
  }

  function start() {
    try { void run(debug ? parseExtraction(JSON.parse(input)) : parseExtraction(extractions)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid JSON.') }
  }

  async function importFiles(files: FileList | null) {
    if (!files) return
    setImporting(true)
    try {
      if (Array.from(files).reduce((total, file) => total + file.size, 0) > 40_000_000) throw new Error('Import size must be below 40 MB.')
      const documents: ExtractionResult[] = []
      for (const file of Array.from(files)) documents.push(...parseExtraction(JSON.parse(await file.text())))
      const parsed = parseExtraction(documents)
      const emails = new Set(parsed.map(item => item.email.email_id))
      if (mounted.current) {
        setInput(JSON.stringify({ extractions: parsed }, null, 2))
        setInputSummary(`${parsed.length} extracted document${parsed.length === 1 ? '' : 's'} loaded, covering ${emails.size} email${emails.size === 1 ? '' : 's'}.`)
        setError('')
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not read the extraction JSON.')
    } finally { if (mounted.current) setImporting(false) }
  }

  const results = response?.results ?? []
  const effective = (result: ComparisonResult): CompareStatus => decisions[result.email_id]?.status ?? result.status
  const outstanding = results.filter(result => (result.status === 'NEEDS_REVIEW' || result.review_fields.length > 0) && !decisions[result.email_id]).length

  // Counts follow the effective status, so resolving a review case moves the
  // email out of the review tally straight away.
  const counts = { OK: 0, MISMATCH: 0, NEEDS_REVIEW: 0 }
  for (const result of results) counts[effective(result)] += 1

  const filtered = results.filter(result =>
    (filter === 'all' || effective(result) === filter) &&
    `${result.email_id} ${result.si_document ?? ''} ${result.bl_document ?? ''}`.toLowerCase().includes(search.toLowerCase()))
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const shown = filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE)

  function download() {
    const report = {
      workspace: debug ? 'debug' : 'pipeline',
      stage: 'si_bl_comparison',
      reference_document: 'Shipping Instruction',
      checked_fields: checkedFields,
      summary: { ...response?.summary, after_human_review: counts, outstanding_review: outstanding },
      emails: results.map(result => {
        const decision = decisions[result.email_id]
        return {
          ...result,
          effective_status: decision?.status ?? result.status,
          effective_defect_fields: decision ? decision.fields : result.defect_fields,
          human_decision: decision ?? null,
          decided_by: decision ? 'human' : 'rules',
        }
      }),
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = debug ? 'debug-comparison-report.json' : 'pipeline-comparison-report.json'
    document.body.append(anchor); anchor.click(); anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="comparison-workspace">
      {!debug && <div className="metrics" aria-label="Comparison summary">
        <div><span>Emails checked</span><strong>{String(results.length).padStart(2, '0')}</strong><small>One SI against one draft BL</small></div>
        <div><span>No mismatch</span><strong className={counts.OK ? 'green-text' : ''}>{String(counts.OK).padStart(2, '0')}</strong><small>All seven fields agree</small></div>
        <div><span>Mismatch found</span><strong className={counts.MISMATCH ? 'red-text' : ''}>{String(counts.MISMATCH).padStart(2, '0')}</strong><small>At least one field differs</small></div>
        <div><span>Needs review</span><strong className={outstanding ? 'amber-text' : ''}>{String(counts.NEEDS_REVIEW).padStart(2, '0')}</strong><small>{outstanding ? `${outstanding} still awaiting a person` : 'All resolved'}</small></div>
      </div>}

      <section className="panel intake" aria-labelledby={`${prefix}-heading`}>
        <div className="section-heading">
          <div><p className="eyebrow">{debug ? 'Isolated stage test' : 'Check the documents'}</p><h2 id={`${prefix}-heading`}>{debug ? 'Test SI against draft BL' : 'Compare shipping instructions with draft bills of lading'}</h2></div>
          <span className="badge blue">POST /api/v1/compare</span>
        </div>
        <p>{debug ? 'Send extracted documents straight to the comparison rules and inspect every field decision.' : 'Compare the extraction results from the pipeline above. The Shipping Instruction is the reference for every check.'}</p>

        {debug ? <>
        <section aria-label="Saved extraction results">
          <h3>Saved extraction results</h3>
          <p>Reuse a previous Pipeline or Extraction Debug result. The latest result per email and workspace is kept, up to 20 results in this browser.</p>
          {storageWarning && <p className="error" role="status">{storageWarning}</p>}
          {savedExtractions.length ? <>
            <label className="extraction-email">Saved extraction<select value={selectedSaved?.id ?? ''} disabled={busy || importing} onChange={event => setSavedId(event.target.value)}>
              {savedExtractions.map(entry => <option key={entry.id} value={entry.id}>{entry.result.email.email_id} · {entry.source} · {new Date(entry.savedAt).toLocaleString()}</option>)}
            </select></label>
            {selectedSaved && <p>BL: {selectedSaved.result.bl.status.replaceAll('_', ' ')} · SI: {selectedSaved.result.si.status.replaceAll('_', ' ')}</p>}
            <button className="secondary" disabled={busy || importing || !selectedSaved} onClick={() => {
              if (!selectedSaved) return
              setInput(JSON.stringify(selectedSaved.result, null, 2))
              setInputSummary(`Loaded saved extraction: ${selectedSaved.result.email.email_id} · ${selectedSaved.source}. Run comparison below.`)
              setResponse(null); setDecisions({}); setError(''); setPage(0)
            }}>Use saved extraction</button>
          </> : <p>No saved extractions yet. Run extraction in Pipeline or Debug → Extraction, then return here.</p>}
        </section>

        <label className="upload-zone">
          <Icon name="upload" />
          <span><strong>Choose extraction output</strong><small>Extraction JSON with email, bl, and si; one result or an array · up to 40 MB</small></span>
          <input type="file" accept=".json,application/json" multiple disabled={busy || importing} onChange={event => void importFiles(event.target.files)} />
        </label>
        <p className="input-summary">{inputSummary}</p>

        <details className="json-editor" open={debug || undefined}>
          <summary>{debug ? 'Request body' : 'Or paste extraction JSON / view imported documents'}</summary>
          <label htmlFor={`${prefix}-json`}>Extraction JSON</label>
          <textarea id={`${prefix}-json`} value={input} disabled={busy || importing} spellCheck={false}
            aria-describedby={error ? `${prefix}-error` : undefined}
            onChange={event => { setInput(event.target.value); setInputSummary('Custom JSON input. Validated when you run the comparison.') }} />
        </details>
        </> : <p role="status">{extractions.length} pipeline extraction result(s) ready to compare.</p>}
        {error && <p className="error" id={`${prefix}-error`} role="alert" tabIndex={-1}>{error}</p>}

        <div className="run-toolbar">
          <button disabled={busy || importing || (!debug && !extractions.length)} onClick={start}><Icon name="play" />{busy ? 'Comparing…' : debug ? 'Run comparison test' : 'Run comparison'}</button>
          {busy && <button className="secondary" onClick={() => controller.current?.abort()}>Stop</button>}
          <span role="status">{importing ? 'Reading files…' : busy ? 'Comparing every pair…' : response ? `${results.length} email${results.length === 1 ? '' : 's'} compared` : 'Rule-based comparison on the backend. No model calls.'}</span>
        </div>
      </section>

      {response?.summary.unpaired_files.length ? (
        <p className="error" role="status">Not compared — these file names do not end in _SI or _BL: {response.summary.unpaired_files.join(', ')}</p>
      ) : null}

      <section aria-labelledby={`${prefix}-results`}>
        <div className="results-header">
          <div><p className="eyebrow">{debug ? 'Test output' : 'Discrepancy report'}</p><h2 id={`${prefix}-results`}>Field-by-field results <span className="count">{results.length}</span></h2></div>
          <button className="secondary" disabled={!results.length || busy} onClick={download}><Icon name="download" />Export report</button>
        </div>

        <div className="queue-tools">
          <label className="search">Search emails<input type="search" value={search} placeholder="Search by email ID or document name" onChange={event => { setSearch(event.target.value); setPage(0) }} /></label>
          <div className="segmented" role="group" aria-label="Filter by outcome">
            {([['all', `All (${results.length})`], ['MISMATCH', `Mismatch (${counts.MISMATCH})`], ['NEEDS_REVIEW', `Needs review (${counts.NEEDS_REVIEW})`], ['OK', `No mismatch (${counts.OK})`]] as [Filter, string][])
              .map(([value, text]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(0) }}>{text}</button>)}
          </div>
        </div>

        {!shown.length && <div className="empty">
          <Icon name="compare" />
          <h3>{results.length ? 'No matching emails' : 'Nothing compared yet'}</h3>
          <p>{results.length ? 'Change the search or the filter to see more results.' : debug ? 'Choose a saved extraction, import extraction JSON, or run the sample.' : 'Run extraction in the pipeline above, then choose Run comparison.'}</p>
          <span>Classify → Extract → Compare → Report</span>
        </div>}

        {shown.map(result => {
          const decision = decisions[result.email_id]
          const open = openEmail === result.email_id
          return (
            <article className="panel result-card" key={result.email_id}>
              <div className="result-top">
                <div>
                  <p className="eyebrow">{result.email_id}</p>
                  <h3>{result.si_document ?? 'SI missing'} <span className="against">against</span> {result.bl_document ?? 'BL missing'}</h3>
                </div>
                <StatusBadge status={effective(result)} decided={Boolean(decision)} />
              </div>

              {result.status === 'NEEDS_REVIEW' && <p className="review-reason">
                <Icon name="info" />
                <span><strong>{result.review_reason ? reviewReasons[result.review_reason] : 'This email could not be checked automatically.'}</strong> {result.review_detail}</span>
              </p>}

              {result.status === 'MISMATCH' && <p className="finding">
                {result.defect_fields.length} of seven fields differ: {result.defect_fields.map(field => fieldTitles[field]).join(', ')}.
              </p>}
              {result.status === 'OK' && <p className="finding">No mismatch detected. All seven fields agree.</p>}

              {result.fields.length > 0 && <>
                <button className="secondary disclose" aria-expanded={open} onClick={() => setOpenEmail(open ? null : result.email_id)}>
                  {open ? 'Hide the seven fields' : 'Show the seven fields side by side'}
                </button>
                {open && <div className="field-table-wrap">
                  <table className="field-table">
                    <caption>Extracted shipment values; SI is the source of truth.</caption>
                    <thead><tr><th scope="col">Field</th><th scope="col">Draft Bill of Lading</th><th scope="col">SI — Source of Truth</th><th scope="col">Outcome</th></tr></thead>
                    <tbody>
                      {result.fields.map(row => (
                        <tr key={row.field} className={row.status}>
                          <th scope="row">{fieldTitles[row.field]}</th>
                          <td data-column="Draft Bill of Lading"><span className="doc-label">{row.bl_label ?? fieldTitles[row.field]}</span><span className="doc-value">{row.bl_value || '—'}</span></td>
                          <td data-column="Shipping Instruction"><span className="doc-label">{row.si_label ?? fieldTitles[row.field]}</span><span className="doc-value">{row.si_value || '—'}</span></td>
                          <td data-column="Outcome"><FieldBadge status={row.status} />{row.status !== 'match' && <span className="why">{row.reason}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>}
              </>}

              {decision
                ? <p className="decision"><Icon name="check" />Human decision: {decision.status === 'OK' ? 'no mismatch' : `mismatch in ${decision.fields.map(field => fieldTitles[field]).join(', ') || 'unspecified fields'}`}. {decision.note}</p>
                : (result.status === 'NEEDS_REVIEW' || result.review_fields.length > 0) && <ReviewForm result={result} onResolve={value => setDecisions(previous => ({ ...previous, [result.email_id]: value }))} />}

              {debug && <details className="raw-response"><summary>Inspect raw API result</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>}
            </article>
          )
        })}

        {pageCount > 1 && <div className="pagination">
          <button className="secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button>
          <span>Page {currentPage + 1} of {pageCount}</span>
          <button className="secondary" disabled={currentPage + 1 === pageCount} onClick={() => setPage(currentPage + 1)}>Next</button>
        </div>}

        <p className="session-note"><Icon name="info" />Session-only results. Export the report before leaving or starting a new run. Review unresolved extraction findings or field decisions before closing a review case.</p>
      </section>
    </div>
  )
}

/** Lets a person close a case the rules refused to decide, and records why. */
function ReviewForm({ result, onResolve }: { result: ComparisonResult; onResolve: (decision: Decision) => void }) {
  const [status, setStatus] = useState<'OK' | 'MISMATCH'>('MISMATCH')
  const [fields, setFields] = useState<CheckedField[]>(result.review_fields)
  const [note, setNote] = useState('')
  const unchecked = result.fields.length === 0

  return (
    <form className="review" onSubmit={event => { event.preventDefault(); if (note.trim()) onResolve({ status, fields: status === 'MISMATCH' ? fields : [], note: note.trim() }) }}>
      <h4>Human review required</h4>
      <p>{unchecked
        ? 'No field was compared for this email. Open the source documents, then record what you found.'
        : 'Some fields could not be decided automatically. Check them against the source documents, then record the outcome.'}</p>

      <fieldset>
        <legend>Outcome after checking the documents</legend>
        <label className="choice"><input type="radio" name={`outcome-${result.email_id}`} value="MISMATCH" checked={status === 'MISMATCH'} onChange={() => setStatus('MISMATCH')} /> The draft BL has a discrepancy</label>
        <label className="choice"><input type="radio" name={`outcome-${result.email_id}`} value="OK" checked={status === 'OK'} onChange={() => setStatus('OK')} /> The documents agree — no mismatch</label>
      </fieldset>

      {status === 'MISMATCH' && <fieldset>
        <legend>Which fields are wrong</legend>
        <div className="field-choices">
          {checkedFields.map(field => (
            <label className="choice" key={field}>
              <input type="checkbox" checked={fields.includes(field)}
                onChange={event => setFields(previous => event.target.checked ? [...previous, field] : previous.filter(item => item !== field))} />
              {fieldTitles[field]}
            </label>
          ))}
        </div>
      </fieldset>}

      <label>Decision note<input value={note} required maxLength={2000} onChange={event => setNote(event.target.value)} placeholder="What you checked and what you found" /></label>
      <button disabled={!note.trim() || (status === 'MISMATCH' && !fields.length)}>Record decision</button>
    </form>
  )
}
