import { useEffect, useRef, useState } from 'react'
import { getExtractionEmail, getExtractionEmails, runExtraction, shipmentFields, type DocumentExtraction, type EmailRecord, type ExtractionResult } from '../lib/api'

export function ExtractionWorkspace({ onSaveExtraction, storageWarning }: { onSaveExtraction: (result: ExtractionResult, source: 'Extraction Debug') => void; storageWarning: string }) {
  const [ids, setIds] = useState<string[]>([])
  const [selected, setSelected] = useState('')
  const [email, setEmail] = useState<EmailRecord | null>(null)
  const [result, setResult] = useState<ExtractionResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('Request eligible email IDs to begin.')
  const controller = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort() } }, [])

  async function request(action: 'list' | 'email' | 'extract') {
    if (controller.current) return
    const abort = new AbortController()
    controller.current = abort
    setBusy(true); setError('')
    setStatus(action === 'extract' ? 'Retrieving Docker attachments and extracting BL and SI…' : 'Requesting emails…')
    // Allow the sequential Docker email and attachment requests to finish.
    const timeout = window.setTimeout(() => abort.abort(), action === 'extract' ? 120000 : 30000)
    try {
      if (action === 'list') {
        const eligible = await getExtractionEmails(abort.signal)
        if (!mounted.current || abort.signal.aborted) return
        setIds(eligible); setSelected(eligible[0] ?? ''); setEmail(null); setResult(null)
        setStatus(eligible.length ? `${eligible.length} BL_COMPARISON emails available. Select one to request from Docker.` : 'No BL_COMPARISON emails are present in the category catalog.')
      } else if (action === 'email') {
        setEmail(null); setResult(null)
        const record = await getExtractionEmail(selected, abort.signal)
        if (!mounted.current || abort.signal.aborted) return
        setEmail(record); setStatus(`${record.email_id} loaded. Ready to run extraction.`)
      } else {
        setResult(null)
        const extracted = await runExtraction(selected, abort.signal)
        if (!mounted.current || abort.signal.aborted) return
        setEmail(extracted.email); setResult(extracted); onSaveExtraction(extracted, 'Extraction Debug')
        setStatus(extracted.bl.status === 'extracted' && extracted.si.status === 'extracted' ? 'BL and SI extracted. Compare their JSON below; expand source evidence as needed.' : 'Extraction finished with issues. Compare each document’s JSON and warnings below.')
      }
    } catch (cause) {
      if (mounted.current) { setError(abort.signal.aborted ? 'Request stopped or timed out. Retry when ready.' : cause instanceof Error ? cause.message : 'Could not reach the backend.'); setStatus('Request did not complete.') }
    } finally {
      window.clearTimeout(timeout)
      if (controller.current === abort) controller.current = null
      if (mounted.current) setBusy(false)
    }
  }

  function downloadJson() {
    if (!result) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${result.email.email_id}-extraction.json`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <div className="extraction-workspace">
    <section className="panel">
      <p className="eyebrow">Isolated stage test</p><h2>Extraction test bench</h2>
      <p>Choose a ground-truth BL_COMPARISON email. Extract shipment fields independently from its Docker BL and SI attachments.</p>
      <div className="run-toolbar"><button className="secondary" disabled={busy} onClick={() => void request('list')}>Request BL_COMPARISON emails</button></div>
      <label className="extraction-email">Email<select value={selected} disabled={busy || !ids.length} onChange={event => { setSelected(event.target.value); setEmail(null); setResult(null); setError(''); setStatus('Request the selected email to continue.') }}><option value="" disabled>Select an email</option>{ids.map(id => <option key={id} value={id}>{id}</option>)}</select></label>
      <div className="run-toolbar"><button className="secondary" disabled={busy || !selected} onClick={() => void request('email')}>Request selected email</button><button disabled={busy || !email || email.email_id !== selected} onClick={() => void request('extract')}>Run extraction test</button>{busy && <button className="secondary" onClick={() => controller.current?.abort()}>Stop request</button>}</div>
      <p role="status">{status}</p>{error && <p className="error" role="alert">{error}</p>}
      {storageWarning && <p className="error" role="status">{storageWarning}</p>}
      {result && <p role="status">Extraction saved for reuse in Debug → Comparison{storageWarning ? " during this session" : " in this browser"}.</p>}
      {result && <button className="secondary" disabled={busy} onClick={downloadJson}>Download extraction JSON</button>}
      {email && <details><summary>{email.email_id} · {email.subject || '(No subject)'}</summary><p>From: {email.from}</p><pre>{email.body}</pre><ul>{email.attachments?.map(path => <li key={path}>{path}</li>)}</ul></details>}
    </section>
    <div className="extraction-pair" aria-label="BL and SI extraction results">
      <JsonDocumentPanel kind="BL" result={result?.bl}/>
      <JsonDocumentPanel kind="SI" result={result?.si}/>
    </div>
    <p className="session-note">Extraction results are saved in this browser for Comparison Debug. Missing or ambiguous fields require review. Comparison and discrepancy reporting have not run.</p>
  </div>
}

export function DocumentPanel({ kind, result }: { kind: 'BL' | 'SI'; result?: DocumentExtraction }) {
  return <section className="panel extraction-document" aria-label={`${kind} extraction`}>
    <p className="eyebrow">{kind === 'BL' ? 'Bill of Lading' : 'Shipping Instruction'}</p><h2>{kind === 'SI' ? 'SI — Source of Truth' : 'BL'}</h2>
    <span className={`badge ${result?.status === 'extracted' ? 'green' : 'neutral'}`}>{result ? result.status.replaceAll('_', ' ') : 'Awaiting extraction'}</span>
    {result?.attachments.map(path => <p className="attachment-path" key={path}>{path}</p>)}
    {result?.error && <p className="error" role="alert">{result.error}</p>}
    {!!result?.warnings.length && <ul className="extraction-warnings">{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
    <dl className="extracted-fields">{shipmentFields.map(([name, title]) => <div key={name}><dt>{title}</dt><dd>{result?.fields?.[name].value ?? (result ? 'Not extracted — review required' : '—')}</dd>{result?.fields?.[name].evidence && <dd><details><summary>Source evidence</summary><blockquote>{result.fields[name].evidence}</blockquote></details></dd>}</div>)}</dl>
    {result?.source_text && <details><summary>Document text</summary><pre>{result.source_text}</pre></details>}
  </section>
}

function JsonDocumentPanel({ kind, result }: { kind: 'BL' | 'SI'; result?: DocumentExtraction }) {
  const comparison = result && {
    document_type: result.document_type,
    status: result.status,
    attachments: result.attachments,
    fields: Object.fromEntries(shipmentFields.map(([name]) => [name, result.fields?.[name].value ?? null])),
    warnings: result.warnings,
    error: result.error,
  }
  return <section className="panel extraction-document" aria-label={`${kind} extraction JSON`}>
    <p className="eyebrow">{kind === 'BL' ? 'Bill of Lading' : 'Shipping Instruction'}</p>
    <h2>{kind === 'SI' ? 'SI — Source of Truth' : 'BL'} JSON</h2>
    {comparison ? <>
      <pre className="extraction-json">{JSON.stringify(comparison, null, 2)}</pre>
      <details><summary>Full JSON with source evidence</summary><pre className="extraction-json">{JSON.stringify(result, null, 2)}</pre></details>
    </> : <p>Run extraction to see this document’s JSON.</p>}
  </section>
}
