import { useState } from 'react'
import { Icon } from '../components/Icon'
import { buildSubmission, parseClassificationReport, parseComparisonReport, type ReportClassification, type ReportComparison } from '../lib/report'
import { loadReportHistory, rememberReportRun, saveReportHistory, type ReportHistory } from '../lib/reportHistory'

export function ReportWorkspace({ debug = false, classifications = [], comparison = null }: {
  debug?: boolean
  classifications?: ReportClassification[]
  comparison?: ReportComparison | null
}) {
  const [classificationJson, setClassificationJson] = useState('')
  const [comparisonJson, setComparisonJson] = useState('')
  const [debugInput, setDebugInput] = useState<{ classifications: ReportClassification[]; comparison: ReportComparison } | null>(null)
  const [history, setHistory] = useState<ReportHistory>(() => {
    try { return loadReportHistory(window.localStorage) }
    catch { return { runs: [], nextId: 1, warning: 'Browser storage is unavailable. Report runs will be kept for this session only.' } }
  })
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const source = debug ? debugInput : { classifications, comparison }
  const { submission, issues } = buildSubmission(source?.classifications ?? [], source?.comparison ?? null)
  const ready = !issues.length
  const rows = Object.entries(submission)
  const counts = { OK: 0, MISMATCH: 0, NEEDS_REVIEW: 0 }
  for (const row of Object.values(submission)) counts[row.status] += 1

  function prepareDebug() {
    try {
      const input = {
        classifications: parseClassificationReport(JSON.parse(classificationJson)),
        comparison: parseComparisonReport(JSON.parse(comparisonJson)),
      }
      setDebugInput(input)
      setError('')
      const selected = history.runs.find(run => run.id === selectedRunId)
      if (!selected || selected.classificationJson !== classificationJson || selected.comparisonJson !== comparisonJson) {
        const next = rememberReportRun(history, classificationJson, comparisonJson)
        let saved: ReportHistory
        try { saved = saveReportHistory(window.localStorage, next) }
        catch { saved = { ...next, warning: 'Browser storage is unavailable. Report runs will be kept for this session only.' } }
        setHistory(saved)
        setSelectedRunId(next.nextId - 1)
      }
    } catch (cause) {
      setDebugInput(null)
      setError(cause instanceof Error ? cause.message : 'Could not read report inputs.')
    }
  }

  function selectRun(id: number | null) {
    const selected = history.runs.find(run => run.id === id)
    setSelectedRunId(selected?.id ?? null)
    setClassificationJson(selected?.classificationJson ?? '')
    setComparisonJson(selected?.comparisonJson ?? '')
    setDebugInput(null)
    setError('')
  }

  function download() {
    if (!ready) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(submission, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = debug ? 'debug-submission.json' : 'submission.json'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <section className="report-workspace" aria-labelledby={debug ? 'debug-report-title' : 'pipeline-report-title'}>
    <div className="results-header"><div><p className="eyebrow">{debug ? 'Isolated stage test' : 'Final stage'}</p><h2 id={debug ? 'debug-report-title' : 'pipeline-report-title'}>Submission report</h2></div><span className="badge blue">JSON</span></div>
    <div className="panel">
      <p>Export one record per email in the format of <code>sample_submission.json</code>. The report uses confirmed classification categories and SI/BL comparison results. No answer-key data is used.</p>
      {debug && <div className="report-inputs">
        <div className="report-saved-runs">
          <label htmlFor="report-saved-run">Saved report run</label>
          <select id="report-saved-run" value={selectedRunId ?? ''} onChange={event => selectRun(event.target.value ? Number(event.target.value) : null)}>
            <option value="">Choose a saved run</option>
            {history.runs.map(run => <option key={run.id} value={run.id}>Run #{run.id} · {new Date(run.savedAt).toLocaleString()}</option>)}
          </select>
          <p>{history.runs.length ? 'Choosing a run restores its paired Classification and Comparison exports. Check both inputs, then build the report.' : 'Paste both exports and build the report to save Run #1.'}</p>
          {history.warning && <p className="error" role="status">{history.warning}</p>}
        </div>
        <label>Classification export JSON<textarea value={classificationJson} onChange={event => { setClassificationJson(event.target.value); setSelectedRunId(null); setDebugInput(null) }} spellCheck={false} placeholder="Paste the Classification stage export" /></label>
        <label>Comparison export JSON<textarea value={comparisonJson} onChange={event => { setComparisonJson(event.target.value); setSelectedRunId(null); setDebugInput(null) }} spellCheck={false} placeholder="Paste the Comparison stage export" /></label>
        <button disabled={!classificationJson || !comparisonJson} onClick={prepareDebug}><Icon name="play"/>Build report test</button>
      </div>}
      {error && <p className="error" role="alert">{error}</p>}
      {issues.length > 0 && <div className="report-issues" role="status"><strong>Report needs more work</strong><ul>{issues.slice(0, 10).map((issue, index) => <li key={index}>{issue}</li>)}</ul>{issues.length > 10 && <p>And {issues.length - 10} more. Complete the earlier stages and try again.</p>}</div>}
      {ready && <>
        <p role="status">Ready: {rows.length} email{rows.length === 1 ? '' : 's'} · {counts.OK} OK · {counts.MISMATCH} mismatch · {counts.NEEDS_REVIEW} needs review.</p>
        <p>Review cases retain their <code>review_reason</code>. Resolve them in Comparison if you need a final human decision reflected in the file.</p>
        <pre className="extraction-json report-preview">{JSON.stringify(submission, null, 2)}</pre>
      </>}
      <div className="run-toolbar"><button disabled={!ready} onClick={download}><Icon name="download"/>Download submission JSON</button></div>
    </div>
  </section>
}
