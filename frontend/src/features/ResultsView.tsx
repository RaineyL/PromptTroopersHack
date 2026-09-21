import { useEffect, useMemo, useRef, useState } from 'react'
import { fieldTitles } from '../lib/api'
import { Icon } from '../components/Icon'
import {
  comparisonNeedsDecision,
  type PipelineState,
} from '../lib/usePipelineState'

const PAGE_SIZE = 50

interface ResultsViewProps {
  pipeline: PipelineState
  onNavigate: (view: 'review' | 'classification', emailId?: string) => void
}

export function ResultsView({ pipeline, onNavigate }: ResultsViewProps) {
  const {
    rows,
    running,
    loading,
    report,
    completedCount,
  } = pipeline

  const [outcomeFilter, setOutcomeFilter] = useState<'ALL' | 'OK' | 'MISMATCH' | 'NEEDS_REVIEW'>('ALL')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [scrollTrigger, setScrollTrigger] = useState(0)
  const detailRef = useRef<HTMLElement | null>(null)

  function showDetails(emailId: string) {
    setSelected(emailId)
    setScrollTrigger(previous => previous + 1)
  }

  useEffect(() => {
    if (!selected) return
    const raf = requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => cancelAnimationFrame(raf)
  }, [selected, scrollTrigger])

  // Filter to BL_COMPARISON emails only
  const blRows = useMemo(
    () =>
      rows.filter(row => {
        const cat =
          row.categoryDecision?.category ?? row.classification?.classification.category
        return cat === 'BL_COMPARISON'
      }),
    [rows]
  )

  const visible = useMemo(
    () =>
      blRows.filter(row => {
        const status =
          row.comparisonDecision?.status ??
          row.comparison?.status ??
          (row.processing ? 'PROCESSING' : 'PENDING')

        const matchesFilter =
          outcomeFilter === 'ALL' ||
          (outcomeFilter === 'NEEDS_REVIEW' &&
            (status === 'NEEDS_REVIEW' || status === 'UNABLE_TO_VERIFY' || comparisonNeedsDecision(row))) ||
          status === outcomeFilter

        const matchesSearch = `${row.email.email_id} ${row.email.subject ?? ''} ${row.email.from ?? ''}`
          .toLowerCase()
          .includes(search.toLowerCase())

        return matchesFilter && matchesSearch
      }),
    [blRows, outcomeFilter, search]
  )

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const shown = visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)

  const comparedCount = blRows.filter(r => r.comparison).length
  const okCount = blRows.filter(
    r => (r.comparisonDecision?.status ?? r.comparison?.status) === 'OK'
  ).length
  const mismatchCount = blRows.filter(
    r => (r.comparisonDecision?.status ?? r.comparison?.status) === 'MISMATCH'
  ).length
  const reviewCount = blRows.filter(
    r =>
      comparisonNeedsDecision(r) ||
      (r.comparisonDecision?.status ?? r.comparison?.status) === 'NEEDS_REVIEW' ||
      r.comparisonDecision?.status === 'UNABLE_TO_VERIFY'
  ).length

  function exportReport() {
    if (report.issues.length || running || loading) return
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report.submission, null, 2)], {
        type: 'application/json',
      })
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'submission.json'
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const active = blRows.find(row => row.email.email_id === selected)

  return (
    <div className="results-view">
      <div className="pipeline-stats" aria-label="Results metrics">
        <div>
          <span>BL Comparisons</span>
          <strong>
            {comparedCount}/{blRows.length}
          </strong>
        </div>
        <div>
          <span>Matches (OK)</span>
          <strong className="green-text">{okCount}</strong>
        </div>
        <div>
          <span>Mismatches</span>
          <strong className={mismatchCount ? 'red-text' : ''}>{mismatchCount}</strong>
        </div>
        <div>
          <span>Needs Review</span>
          <strong className={reviewCount ? 'amber-text' : ''}>{reviewCount}</strong>
        </div>
      </div>

      <section className="panel pipeline-results">
        <div className="section-heading">
          <div>
            <p className="eyebrow">03 · Results</p>
            <h2>Extraction & Comparison Results</h2>
          </div>
          <div className="pipeline-actions" style={{ margin: 0 }}>
            <button
              className="secondary"
              disabled={!rows.length || !!report.issues.length || loading || running}
              onClick={exportReport}
            >
              <Icon name="download" />
              Export JSON report ({completedCount}/{rows.length})
            </button>
            {reviewCount > 0 && (
              <button
                className="secondary"
                onClick={() => onNavigate('review')}
                style={{ borderColor: '#dfcda8', background: 'var(--amber-tint)', color: 'var(--amber)' }}
              >
                <Icon name="user" />
                Resolve {reviewCount} review item{reviewCount > 1 ? 's' : ''}
              </button>
            )}
          </div>
        </div>

        {report.issues.length > 0 && rows.length > 0 && !running && (
          <div className="report-issues" style={{ margin: '14px 0' }}>
            <strong>Export blocked by pending items ({report.issues.length}):</strong>
            <ul>
              {report.issues.slice(0, 5).map((issue: string, idx: number) => (
                <li key={idx}>{issue}</li>
              ))}
              {report.issues.length > 5 && (
                <li>...and {report.issues.length - 5} more items</li>
              )}
            </ul>
          </div>
        )}

        <div className="pipeline-filters">
          <label>
            Search
            <input
              type="search"
              value={search}
              placeholder="Subject, sender or ID"
              onChange={event => {
                setSearch(event.target.value)
                setPage(0)
              }}
            />
          </label>
          <label>
            Outcome
            <select
              value={outcomeFilter}
              onChange={event => {
                setOutcomeFilter(
                  event.target.value as 'ALL' | 'OK' | 'MISMATCH' | 'NEEDS_REVIEW'
                )
                setPage(0)
              }}
            >
              <option value="ALL">All outcomes</option>
              <option value="OK">OK (Match)</option>
              <option value="MISMATCH">Mismatch</option>
              <option value="NEEDS_REVIEW">Needs Review</option>
            </select>
          </label>
        </div>

        <div className="pipeline-table-wrap">
          <table className="pipeline-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Extraction</th>
                <th>Outcome</th>
                <th>Defects</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(row => {
                const isNeedsReview = comparisonNeedsDecision(row)
                const outcome = row.error
                  ? 'Failed'
                  : row.processing
                  ? 'Processing'
                  : row.comparisonDecision
                  ? row.comparisonDecision.status
                  : row.comparison
                  ? row.comparison.status
                  : 'Pending'

                const defectFields = row.comparisonDecision?.fields ??
                  row.comparison?.defect_fields ??
                  []

                return (
                  <tr
                    key={row.email.email_id}
                    className={selected === row.email.email_id ? 'is-selected' : ''}
                  >
                    <td data-label="Email">
                      <button
                        className="row-link"
                        onClick={() => showDetails(row.email.email_id)}
                        aria-label={`View ${row.email.email_id}`}
                      >
                        <strong>{row.email.subject || '(No subject)'}</strong>
                        <small>
                          {row.email.email_id} · {row.email.from || 'Unknown sender'}
                        </small>
                      </button>
                    </td>
                    <td data-label="Extraction">
                      {row.extraction ? (
                        <small>
                          BL: {row.extraction.bl.status} · SI: {row.extraction.si.status}
                        </small>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td data-label="Outcome">
                      <span
                        className={`badge ${
                          outcome === 'OK'
                            ? 'green'
                            : outcome === 'MISMATCH'
                            ? 'red'
                            : outcome === 'NEEDS_REVIEW' || isNeedsReview || outcome === 'UNABLE_TO_VERIFY'
                            ? 'amber'
                            : 'neutral'
                        }`}
                      >
                        {isNeedsReview
                          ? 'NEEDS REVIEW'
                          : outcome === 'UNABLE_TO_VERIFY'
                          ? 'UNABLE TO VERIFY'
                          : outcome}
                      </span>
                    </td>
                    <td data-label="Defects">
                      {defectFields.length > 0 ? (
                        <small>{defectFields.map(f => fieldTitles[f] || f).join(', ')}</small>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td data-label="Action">
                      {isNeedsReview ? (
                        <button
                          className="secondary"
                          onClick={() => onNavigate('review', row.email.email_id)}
                          style={{ color: 'var(--amber)', borderColor: '#dfcda8' }}
                        >
                          Resolve
                        </button>
                      ) : (
                        <button
                          className="secondary"
                          onClick={() => showDetails(row.email.email_id)}
                        >
                          Details
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {!visible.length && (
          <p className="pipeline-empty">
            {blRows.length
              ? 'No comparison results match this filter.'
              : rows.length
              ? 'No BL Comparison requests found in the current inbox.'
              : 'Upload a bundle and run the pipeline to view comparison results.'}
          </p>
        )}

        {pageCount > 1 && (
          <div className="pagination">
            <button
              className="secondary"
              disabled={currentPage === 0}
              onClick={() => {
                setPage(currentPage - 1)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
            >
              Previous
            </button>
            <span>
              Page {currentPage + 1} of {pageCount} · {visible.length} results
            </span>
            <button
              className="secondary"
              disabled={currentPage + 1 === pageCount}
              onClick={() => {
                setPage(currentPage + 1)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
            >
              Next
            </button>
          </div>
        )}
      </section>

      {active && (
        <section
          ref={detailRef}
          id="comparison-detail-section"
          className="panel pipeline-detail"
          aria-labelledby="comparison-detail-heading"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Comparison detail · {active.email.email_id}</p>
              <h2 id="comparison-detail-heading">{active.email.subject || '(No subject)'}</h2>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="secondary"
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                aria-label="Back to table"
              >
                Back to table ↑
              </button>
              <button
                className="secondary"
                onClick={() => setSelected(null)}
                aria-label="Close detail"
              >
                Close
              </button>
            </div>
          </div>

          {active.extraction && (
            <div className="pipeline-finding">
              <h3>Document Extraction Status</h3>
              <p>
                Bill of Lading: <strong>{active.extraction.bl.status}</strong> · Shipping
                Instruction: <strong>{active.extraction.si.status}</strong>
              </p>
              {[active.extraction.bl, active.extraction.si].map(doc => (
                <div key={doc.document_type} style={{ marginTop: '8px' }}>
                  <strong>{doc.document_type}</strong>
                  {doc.warnings.map((warning, index) => (
                    <p key={index} className="subtle">
                      {warning}
                    </p>
                  ))}
                  {doc.error && <p className="error">{doc.error}</p>}
                </div>
              ))}
            </div>
          )}

          {active.comparison && (
            <div className="pipeline-finding">
              <div className="result-top">
                <h3>
                  Field Comparison ·{' '}
                  <span
                    className={`badge ${
                      (active.comparisonDecision?.status ?? active.comparison.status) === 'OK'
                        ? 'green'
                        : (active.comparisonDecision?.status ?? active.comparison.status) ===
                          'MISMATCH'
                        ? 'red'
                        : 'amber'
                    }`}
                  >
                    {(active.comparisonDecision?.status ?? active.comparison.status) ===
                    'UNABLE_TO_VERIFY'
                      ? 'UNABLE TO VERIFY'
                      : active.comparisonDecision?.status ?? active.comparison.status}
                  </span>
                </h3>
                {comparisonNeedsDecision(active) && (
                  <button
                    onClick={() => onNavigate('review', active.email.email_id)}
                    style={{ borderColor: '#dfcda8', background: 'var(--amber-tint)', color: 'var(--amber)' }}
                  >
                    <Icon name="user" /> Resolve in Human Review
                  </button>
                )}
              </div>

              {active.comparison.review_detail && (
                <div className="review-reason">
                  <Icon name="info" />
                  <span>
                    <strong>Review detail:</strong>
                    {active.comparison.review_detail}
                  </span>
                </div>
              )}

              {active.comparisonDecision && (
                <div className="decision" style={{ marginTop: '12px' }}>
                  <Icon name="check" />
                  <span>
                    Human Decision:{' '}
                    <strong>
                      {active.comparisonDecision.status === 'UNABLE_TO_VERIFY'
                        ? 'UNABLE TO VERIFY'
                        : active.comparisonDecision.status}
                    </strong>{' '}
                    — {active.comparisonDecision.note}
                    {active.comparisonDecision.fields.length > 0 && (
                      <span>
                        {' '}
                        (Defective:{' '}
                        {active.comparisonDecision.fields
                          .map(f => fieldTitles[f] || f)
                          .join(', ')}
                        )
                      </span>
                    )}
                  </span>
                </div>
              )}

              {active.comparison.fields.length > 0 && (
                <div className="field-table-wrap">
                  <table className="field-table">
                    <caption>Side-by-side comparison of extracted fields</caption>
                    <thead>
                      <tr>
                        <th>Field</th>
                        <th>Shipping Instruction (SI)</th>
                        <th>Bill of Lading (BL)</th>
                        <th>Outcome</th>
                      </tr>
                    </thead>
                    <tbody>
                      {active.comparison.fields.map(field => (
                        <tr
                          key={field.field}
                          className={
                            field.status === 'mismatch'
                              ? 'mismatch'
                              : field.status === 'review'
                              ? 'review'
                              : ''
                          }
                        >
                          <th scope="row">{fieldTitles[field.field] || field.field}</th>
                          <td data-column="SI">{field.si_value || '—'}</td>
                          <td data-column="BL">{field.bl_value || '—'}</td>
                          <td data-column="Outcome">
                            <span
                              className={`badge ${
                                field.status === 'match'
                                  ? 'green'
                                  : field.status === 'mismatch'
                                  ? 'red'
                                  : 'amber'
                              }`}
                            >
                              {field.status.toUpperCase()}
                            </span>
                            {field.reason && (
                              <span className="why">{field.reason}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
