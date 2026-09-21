import { useEffect, useMemo, useRef, useState } from 'react'
import {
  categories,
  getInboxAttachment,
  type Category,
} from '../lib/api'
import { Icon } from '../components/Icon'
import {
  classificationNeedsDecision,
  needsReview,
  type PipelineState,
} from '../lib/usePipelineState'

const readable = (value: string) => value.replaceAll('_', ' ')
const PAGE_SIZE = 50

interface ClassificationViewProps {
  pipeline: PipelineState
  onNavigate: (view: 'upload' | 'results' | 'review', emailId?: string) => void
}

export function ClassificationView({ pipeline, onNavigate }: ClassificationViewProps) {
  const {
    rows,
    sessionId,
    running,
    run,
    stop,
  } = pipeline

  const [filter, setFilter] = useState<Category | 'ALL'>('ALL')
  const [reviewOnly, setReviewOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [scrollTrigger, setScrollTrigger] = useState(0)
  const [texts, setTexts] = useState<Record<string, string>>({})
  const detailRef = useRef<HTMLElement | null>(null)

  function showDetails(emailId: string) {
    setSelected(emailId)
    setTexts({})
    setScrollTrigger(previous => previous + 1)
  }

  useEffect(() => {
    if (!selected) return
    const raf = requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => cancelAnimationFrame(raf)
  }, [selected, scrollTrigger])

  const active = rows.find(row => row.email.email_id === selected)
  const selectedEmail = active?.email

  useEffect(() => {
    if (!selectedEmail || !sessionId) return
    const txtPaths = (selectedEmail.attachments ?? []).filter(path => /\.txt$/i.test(path))
    const abort = new AbortController()
    void Promise.all(
      txtPaths.map(async path => {
        try {
          const blob = await getInboxAttachment(
            selectedEmail.email_id,
            path,
            abort.signal,
            sessionId
          )
          if (blob.size > 2_000_000) throw new Error('Text preview exceeds 2 MB.')
          const content = await blob.text()
          if (!abort.signal.aborted) setTexts(previous => ({ ...previous, [path]: content }))
        } catch (cause) {
          if (!abort.signal.aborted) {
            setTexts(previous => ({
              ...previous,
              [path]: cause instanceof Error ? cause.message : 'Preview unavailable.',
            }))
          }
        }
      })
    )
    return () => abort.abort()
  }, [sessionId, selectedEmail])

  const visible = useMemo(
    () =>
      rows.filter(row => {
        const cat =
          row.categoryDecision?.category ?? row.classification?.classification.category
        const matchesReview = !reviewOnly || needsReview(row)
        const matchesCategory = filter === 'ALL' || cat === filter
        const matchesSearch = `${row.email.email_id} ${row.email.subject ?? ''} ${row.email.from ?? ''}`
          .toLowerCase()
          .includes(search.toLowerCase())
        return matchesReview && matchesCategory && matchesSearch
      }),
    [rows, filter, reviewOnly, search]
  )

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const shown = visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)

  const classifiedCount = rows.filter(row => row.classification).length
  const pendingReviewCount = rows.filter(classificationNeedsDecision).length

  return (
    <div className="classification-view">
      <div className="pipeline-stats" aria-label="Classification summary">
        <div>
          <span>Total Emails</span>
          <strong>{rows.length}</strong>
        </div>
        <div>
          <span>Classified</span>
          <strong>{classifiedCount}</strong>
        </div>
        <div>
          <span>Needs Decision</span>
          <strong className={pendingReviewCount ? 'amber-text' : ''}>{pendingReviewCount}</strong>
        </div>
        <div>
          <span>BL Comparison Requests</span>
          <strong>
            {
              rows.filter(
                r =>
                  (r.categoryDecision?.category ??
                    r.classification?.classification.category) === 'BL_COMPARISON'
              ).length
            }
          </strong>
        </div>
      </div>

      <section className="panel pipeline-results">
        <div className="section-heading">
          <div>
            <p className="eyebrow">02 · Classification</p>
            <h2>Classified Email Queue</h2>
          </div>
          <div className="pipeline-actions" style={{ margin: 0 }}>
            <button
              disabled={!rows.length || running}
              onClick={() => void run()}
            >
              <Icon name="play" />
              {running ? 'Running classification…' : 'Run classification'}
            </button>
            {running && (
              <button className="secondary" onClick={stop}>
                Stop
              </button>
            )}
            {pendingReviewCount > 0 && (
              <button
                className="secondary"
                onClick={() => onNavigate('review')}
                style={{ borderColor: '#dfcda8', background: 'var(--amber-tint)', color: 'var(--amber)' }}
              >
                <Icon name="user" />
                Resolve {pendingReviewCount} review item{pendingReviewCount > 1 ? 's' : ''}
              </button>
            )}
          </div>
        </div>

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
            Category
            <select
              value={filter}
              onChange={event => {
                setFilter(event.target.value as Category | 'ALL')
                setPage(0)
              }}
            >
              <option value="ALL">All categories</option>
              {categories.map(category => (
                <option key={category} value={category}>
                  {readable(category)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary"
            aria-pressed={reviewOnly}
            onClick={() => {
              setReviewOnly(!reviewOnly)
              setFilter('ALL')
              setSearch('')
              setPage(0)
            }}
          >
            {reviewOnly ? 'Show all emails' : `Needs decision (${pendingReviewCount})`}
          </button>
        </div>

        <div className="pipeline-table-wrap">
          <table className="pipeline-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Category</th>
                <th>Outcome</th>
                <th>Attachments</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(row => {
                const category =
                  row.categoryDecision?.category ??
                  row.classification?.classification.category
                const hasReview = classificationNeedsDecision(row)
                const outcome = row.error
                  ? 'Failed'
                  : row.processing
                  ? 'Processing'
                  : !row.classification
                  ? 'Not started'
                  : hasReview
                  ? 'Human Decision Required'
                  : 'Classified'

                return (
                  <tr
                    key={row.email.email_id}
                    className={selected === row.email.email_id ? 'is-selected' : ''}
                  >
                    <td data-label="Email">
                      <button
                        className="row-link"
                        onClick={() => showDetails(row.email.email_id)}
                        aria-label={`View ${row.email.email_id}: ${
                          row.email.subject || 'No subject'
                        }`}
                      >
                        <strong>{row.email.subject || '(No subject)'}</strong>
                        <small>
                          {row.email.email_id} · {row.email.from || 'Unknown sender'}
                        </small>
                      </button>
                    </td>
                    <td data-label="Category">
                      {category ? (
                        <span
                          className={`badge ${
                            category === 'BL_COMPARISON'
                              ? 'blue'
                              : category === 'SPAM'
                              ? 'neutral'
                              : 'green'
                          }`}
                        >
                          {readable(category)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td data-label="Outcome">
                      <span
                        className={`outcome ${
                          outcome === 'Human Decision Required' || outcome === 'Failed'
                            ? 'attention'
                            : ''
                        }`}
                      >
                        {outcome}
                      </span>
                    </td>
                    <td data-label="Attachments">{row.email.attachments?.length ?? 0}</td>
                    <td data-label="Action">
                      {row.error ? (
                        <button
                          className="secondary"
                          disabled={running}
                          onClick={() => void run(row.email.email_id)}
                        >
                          Retry
                        </button>
                      ) : hasReview ? (
                        <button
                          className="secondary"
                          onClick={() => onNavigate('review', row.email.email_id)}
                          style={{ color: 'var(--amber)', borderColor: '#dfcda8' }}
                        >
                          Review
                        </button>
                      ) : (
                        <button
                          className="secondary"
                          onClick={() => showDetails(row.email.email_id)}
                        >
                          View
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
            {rows.length
              ? 'No emails match this filter.'
              : 'No emails loaded. Please upload a ZIP bundle first.'}
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
              Page {currentPage + 1} of {pageCount} · {visible.length} emails
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
          id="classification-detail-section"
          className="panel pipeline-detail"
          aria-labelledby="email-detail-heading"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Email detail · {active.email.email_id}</p>
              <h2 id="email-detail-heading">{active.email.subject || '(No subject)'}</h2>
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
                aria-label="Close email detail"
              >
                Close
              </button>
            </div>
          </div>
          <p className="pipeline-from">From {active.email.from || '(not provided)'}</p>
          <h3>Message</h3>
          <pre>{active.email.body}</pre>
          <h3>Attachments ({active.email.attachments?.length ?? 0})</h3>
          {active.email.attachments?.length ? (
            <div className="attachment-list">
              {active.email.attachments.map(path => (
                <div key={path}>
                  <strong>{path.split('/').at(-1)}</strong>
                  <code>{path}</code>
                  {/\.txt$/i.test(path) && (
                    <pre className="attachment-preview">
                      {texts[path] ?? 'Loading text…'}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p>No attachments.</p>
          )}

          {active.error && (
            <p className="error" role="alert">
              {active.error}{' '}
              <button
                className="secondary"
                disabled={running}
                onClick={() => void run(active.email.email_id)}
              >
                Retry email
              </button>
            </p>
          )}

          {active.classification && (
            <div className="pipeline-finding">
              <h3>
                Classification ·{' '}
                {readable(
                  active.categoryDecision?.category ??
                    active.classification.classification.category
                )}
              </h3>
              <p>{active.classification.classification.rationale}</p>
              <ul>
                {active.classification.classification.evidence.map((evidence, index) => (
                  <li key={index}>
                    {evidence.source}: {evidence.signal}
                  </li>
                ))}
              </ul>

              {active.classification.classification.needs_human_review &&
                !active.categoryDecision && (
                  <div className="review">
                    <h3>Ambiguous Classification</h3>
                    <p>
                      {active.classification.classification.ambiguity_reason ||
                        active.classification.classification.question_for_user ||
                        'Confirm the correct category to continue.'}
                    </p>
                    <button
                      onClick={() => onNavigate('review')}
                      style={{ marginTop: '8px' }}
                    >
                      <Icon name="user" />
                      Open in Human Review Workspace
                    </button>
                  </div>
                )}

              {active.categoryDecision && (
                <p className="decision">
                  Confirmed by reviewer: {readable(active.categoryDecision.category)} ·{' '}
                  {active.categoryDecision.note}
                </p>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
