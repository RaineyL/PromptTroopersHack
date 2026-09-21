import { useEffect, useMemo, useState } from 'react'
import {
  categories,
  checkedFields,
  fieldTitles,
  type Category,
  type CheckedField,
} from '../lib/api'
import { Icon } from '../components/Icon'
import {
  classificationNeedsDecision,
  comparisonNeedsDecision,
  type PipelineState,
} from '../lib/usePipelineState'

const readable = (value: string) => value.replaceAll('_', ' ')

const UNABLE_TO_VERIFY_REASONS = [
  'SI document missing',
  'BL document missing',
  'SI and BL documents missing',
  'Multiple documents found',
  'Document extraction failed',
  'Other',
] as const

interface ReviewViewProps {
  pipeline: PipelineState
  targetId?: string | null
  onNavigate: (view: 'classification' | 'results') => void
  onClearTarget?: () => void
}

export function ReviewView({ pipeline, targetId, onNavigate, onClearTarget }: ReviewViewProps) {
  const {
    rows,
    running,
    confirmCategory,
    saveComparisonDecision,
    clearComparisonDecision,
    updateRow,
  } = pipeline

  // Filter mode: 'pending' vs 'all' (User chose: "stay with resolved"!)
  const [filterMode, setFilterMode] = useState<'pending' | 'all'>('pending')
  const [editingComparisonId, setEditingComparisonId] = useState<string | null>(null)

  // Local form state for category review keyed by email_id
  const [categoryForms, setCategoryForms] = useState<
    Record<string, { category: Category; note: string }>
  >({})

  // Local form state for comparison review keyed by email_id
  const [comparisonForms, setComparisonForms] = useState<
    Record<
      string,
      {
        status: '' | 'OK' | 'MISMATCH' | 'UNABLE_TO_VERIFY'
        fields: CheckedField[]
        note: string
        reasons: string[]
        otherReason: string
      }
    >
  >({})

  // Collect all items that were ever flagged for review
  const reviewCases = useMemo(() => {
    return rows.filter(row => {
      const isClassReview = !!row.classification?.classification.needs_human_review
      const isCompReview =
        !!row.comparison &&
        (row.comparison.status === 'NEEDS_REVIEW' || !!row.comparisonDecision)
      return isClassReview || isCompReview
    })
  }, [rows])

  const pendingCases = useMemo(() => {
    return reviewCases.filter(
      row => classificationNeedsDecision(row) || comparisonNeedsDecision(row)
    )
  }, [reviewCases])

  const [clearedTarget, setClearedTarget] = useState<string | null>(null)
  const highlightedId = targetId && targetId !== clearedTarget ? targetId : null

  const isTargetInPending = highlightedId
    ? pendingCases.some(c => c.email.email_id === highlightedId)
    : true
  const effectiveFilterMode = highlightedId && !isTargetInPending ? 'all' : filterMode

  useEffect(() => {
    if (!highlightedId) return

    const timer = setTimeout(() => {
      const element = document.getElementById(`review-case-${highlightedId}`)
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 100)

    const unhighlightTimer = setTimeout(() => {
      setClearedTarget(highlightedId)
      onClearTarget?.()
    }, 4500)

    return () => {
      clearTimeout(timer)
      clearTimeout(unhighlightTimer)
    }
  }, [highlightedId, onClearTarget])

  const visibleCases = effectiveFilterMode === 'pending' ? pendingCases : reviewCases

  const pendingCount = pendingCases.length
  const totalCount = reviewCases.length

  return (
    <div className="review-view">
      <div className="pipeline-stats" aria-label="Review metrics">
        <div>
          <span>Pending Review</span>
          <strong className={pendingCount ? 'amber-text' : 'green-text'}>{pendingCount}</strong>
        </div>
        <div>
          <span>Total Flagged</span>
          <strong>{totalCount}</strong>
        </div>
        <div>
          <span>Classification Decisions</span>
          <strong>{rows.filter(r => r.categoryDecision).length}</strong>
        </div>
        <div>
          <span>Comparison Decisions</span>
          <strong>{rows.filter(r => r.comparisonDecision).length}</strong>
        </div>
      </div>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">04 · Human-in-the-Loop</p>
            <h2>Human Review Queue</h2>
          </div>
          <div className="pipeline-actions" style={{ margin: 0 }}>
            <div className="segmented">
              <button
                type="button"
                aria-pressed={effectiveFilterMode === 'pending'}
                onClick={() => {
                  setFilterMode('pending')
                  onClearTarget?.()
                }}
              >
                Pending only ({pendingCount})
              </button>
              <button
                type="button"
                aria-pressed={effectiveFilterMode === 'all'}
                onClick={() => {
                  setFilterMode('all')
                  onClearTarget?.()
                }}
              >
                All review cases ({totalCount})
              </button>
            </div>
            <button className="secondary" onClick={() => onNavigate('results')}>
              View Results <span className="nav-arrow">→</span>
            </button>
          </div>
        </div>

        <p className="subtle" style={{ marginTop: '8px', marginBottom: '20px' }}>
          Resolve ambiguous classification requests and inspect high-risk document discrepancies
          before exporting final reports.
        </p>

        {visibleCases.length === 0 ? (
          <div className="empty">
            <Icon name="check" />
            <h3>No pending review items</h3>
            <p>
              {totalCount > 0
                ? 'All flagged review cases have been resolved. Your decisions are recorded in the pipeline.'
                : 'No ambiguous classifications or comparison alerts detected.'}
            </p>
            {totalCount > 0 && filterMode === 'pending' && (
              <button className="secondary" onClick={() => setFilterMode('all')}>
                Show resolved cases ({totalCount})
              </button>
            )}
            <div style={{ marginTop: '16px' }}>
              <button onClick={() => onNavigate('results')}>Go to Results</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '24px' }}>
            {visibleCases.map(row => {
              const id = row.email.email_id
              const classFlagged = !!row.classification?.classification.needs_human_review
              const classResolved = !!row.categoryDecision
              const compFlagged =
                !!row.comparison &&
                (row.comparison.status === 'NEEDS_REVIEW' || !!row.comparisonDecision)
              const compResolved = !!row.comparisonDecision && editingComparisonId !== id

              const catForm = categoryForms[id] || {
                category:
                  row.categoryDecision?.category ??
                  row.classification?.classification.category ??
                  'GENERAL',
                note: row.categoryDecision?.note ?? '',
              }

              const dec = row.comparisonDecision
              const isUnable = dec?.status === 'UNABLE_TO_VERIFY'
              const decReasons = dec?.reasons ?? (isUnable && dec?.note ? [dec.note] : [])
              const hasOther = isUnable && decReasons.some(r => !UNABLE_TO_VERIFY_REASONS.includes(r as any))

              const compForm = comparisonForms[id] || {
                status: (dec?.status as '' | 'OK' | 'MISMATCH' | 'UNABLE_TO_VERIFY') ?? '',
                fields: dec?.fields ?? [],
                note: dec?.note ?? '',
                reasons: decReasons,
                otherReason: hasOther ? dec?.note ?? '' : '',
              }

              return (
                <article
                  key={id}
                  id={`review-case-${id}`}
                  className={`panel ${highlightedId === id ? 'highlighted-case' : ''}`}
                  style={{
                    margin: 0,
                    border: highlightedId === id ? '2px solid var(--blue)' : '1px solid var(--line)',
                    background: highlightedId === id ? '#f4f8ff' : '#fff',
                    borderRadius: '8px',
                    boxShadow:
                      highlightedId === id
                        ? '0 0 0 4px #245adc33, 0 6px 20px rgba(36, 90, 220, 0.18)'
                        : '0 1px 3px rgba(0,0,0,0.05)',
                    transition: 'border 300ms ease, box-shadow 300ms ease, background 300ms ease',
                    scrollMarginTop: '100px',
                  }}
                >
                  <div className="result-top">
                    <div>
                      <p className="eyebrow" style={{ margin: 0 }}>
                        Case: {id}
                      </p>
                      <h3 style={{ margin: '4px 0 0' }}>
                        {row.email.subject || '(No subject)'}
                      </h3>
                      <p className="subtle" style={{ margin: '2px 0 0' }}>
                        From: {row.email.from || 'Unknown'} · Attachments:{' '}
                        {row.email.attachments?.length ?? 0}
                      </p>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      {classFlagged && (
                        <span
                          className={`badge ${classResolved ? 'green' : 'amber'}`}
                        >
                          {classResolved ? (
                            <>
                              <Icon name="check" /> Classification Resolved
                            </>
                          ) : (
                            'Classification Review'
                          )}
                        </span>
                      )}
                      {compFlagged && (
                        <span
                          className={`badge ${compResolved ? 'green' : 'amber'}`}
                        >
                          {compResolved ? (
                            <>
                              <Icon name="check" /> Comparison Resolved
                            </>
                          ) : (
                            'Comparison Review'
                          )}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Classification Review Section */}
                  {classFlagged && (
                    <div
                      className="pipeline-finding"
                      style={{ marginTop: '16px', paddingTop: '16px' }}
                    >
                      <h4 style={{ margin: '0 0 8px' }}>Classification Decision</h4>
                      <p className="subtle" style={{ margin: '0 0 8px' }}>
                        Model classified as:{' '}
                        <strong>
                          {readable(row.classification?.classification.category || '')}
                        </strong>
                      </p>
                      {row.classification?.classification.rationale && (
                        <p style={{ fontSize: '12px' }}>
                          {row.classification.classification.rationale}
                        </p>
                      )}

                      {!classResolved ? (
                        <form
                          className="review"
                          onSubmit={event => {
                            event.preventDefault()
                            if (!catForm.note.trim()) return
                            confirmCategory(id, catForm.category, catForm.note.trim())
                          }}
                        >
                          <div className="review-reason" style={{ margin: '0 0 12px' }}>
                            <Icon name="info" />
                            <span>
                              <strong>Ambiguity Reason:</strong>
                              {row.classification?.classification.ambiguity_reason ||
                                row.classification?.classification.question_for_user ||
                                'The model flagged this email as ambiguous. Please specify the correct category.'}
                            </span>
                          </div>

                          <label>
                            Select Category
                            <select
                              value={catForm.category}
                              onChange={e =>
                                setCategoryForms(prev => ({
                                  ...prev,
                                  [id]: {
                                    ...catForm,
                                    category: e.target.value as Category,
                                  },
                                }))
                              }
                            >
                              {categories.map(cat => (
                                <option key={cat} value={cat}>
                                  {readable(cat)}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label>
                            Decision Note
                            <input
                              required
                              placeholder="Reason for classification decision"
                              value={catForm.note}
                              onChange={e =>
                                setCategoryForms(prev => ({
                                  ...prev,
                                  [id]: { ...catForm, note: e.target.value },
                                }))
                              }
                            />
                          </label>

                          <div className="pipeline-actions" style={{ marginTop: '12px' }}>
                            <button disabled={running || !catForm.note.trim()}>
                              <Icon name="check" /> Confirm Category
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div
                          className="decision"
                          style={{
                            background: '#f4fbf7',
                            padding: '12px',
                            border: '1px solid #bce6cd',
                            borderRadius: '6px',
                            marginTop: '10px',
                          }}
                        >
                          <div>
                            <Icon name="check" />
                            <strong>Confirmed:</strong> {readable(row.categoryDecision!.category)}{' '}
                            — {row.categoryDecision!.note}
                          </div>
                          <button
                            type="button"
                            className="secondary"
                            style={{ marginLeft: 'auto', minHeight: '32px', fontSize: '11px' }}
                            onClick={() => {
                              updateRow(id, r => ({
                                ...r,
                                categoryDecision: undefined,
                              }))
                            }}
                          >
                            Re-open
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Comparison Review Section */}
                  {compFlagged && row.comparison && (
                    <div
                      className="pipeline-finding"
                      style={{ marginTop: '16px', paddingTop: '16px' }}
                    >
                      <h4 style={{ margin: '0 0 8px' }}>Comparison Decision</h4>
                      {row.comparison.review_detail && (
                        <div className="review-reason" style={{ margin: '0 0 12px' }}>
                          <Icon name="info" />
                          <span>
                            <strong>Alert Detail:</strong>
                            {row.comparison.review_detail}
                          </span>
                        </div>
                      )}

                      {/* Field comparison preview */}
                      {row.comparison.fields.length > 0 && (
                        <div className="field-table-wrap" style={{ margin: '12px 0' }}>
                          <table className="field-table">
                            <thead>
                              <tr>
                                <th>Field</th>
                                <th>SI Value</th>
                                <th>BL Value</th>
                                <th>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {row.comparison.fields.map(f => (
                                <tr
                                  key={f.field}
                                  className={
                                    f.status === 'mismatch'
                                      ? 'mismatch'
                                      : f.status === 'review'
                                      ? 'review'
                                      : ''
                                  }
                                >
                                  <th scope="row">{fieldTitles[f.field] || f.field}</th>
                                  <td>{f.si_value || '—'}</td>
                                  <td>{f.bl_value || '—'}</td>
                                  <td>
                                    <span
                                      className={`badge ${
                                        f.status === 'match'
                                          ? 'green'
                                          : f.status === 'mismatch'
                                          ? 'red'
                                          : 'amber'
                                      }`}
                                    >
                                      {f.status.toUpperCase()}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {!compResolved ? (
                        <form
                          className="review"
                          onSubmit={event => {
                            event.preventDefault()
                            if (!compForm.status) return
                            if (compForm.status === 'MISMATCH' && (!compForm.fields.length || !compForm.note.trim())) return
                            if (compForm.status === 'OK' && !compForm.note.trim()) return
                            if (
                              compForm.status === 'UNABLE_TO_VERIFY' &&
                              (!compForm.reasons.length || (compForm.reasons.includes('Other') && !compForm.otherReason.trim()))
                            ) {
                              return
                            }
                            saveComparisonDecision(id, {
                              status: compForm.status,
                              fields: compForm.status === 'MISMATCH' ? compForm.fields : [],
                              note: compForm.note.trim(),
                              reasons: compForm.reasons,
                            })
                            setEditingComparisonId(null)
                          }}
                        >
                          <label>
                            Reviewer Decision
                            <select
                              required
                              value={compForm.status}
                              onChange={e => {
                                const nextStatus = e.target.value as '' | 'OK' | 'MISMATCH' | 'UNABLE_TO_VERIFY'
                                let initialReasons = compForm.reasons
                                let initialNote = compForm.note
                                if (nextStatus === 'UNABLE_TO_VERIFY' && !initialReasons.length) {
                                  if (row.comparison?.review_reason === 'missing_attachment') {
                                    if (!row.comparison.si_document && !row.comparison.bl_document) {
                                      initialReasons = ['SI and BL documents missing']
                                    } else if (!row.comparison.si_document) {
                                      initialReasons = ['SI document missing']
                                    } else if (!row.comparison.bl_document) {
                                      initialReasons = ['BL document missing']
                                    } else {
                                      initialReasons = ['SI document missing']
                                    }
                                  } else if (row.comparison?.review_reason === 'wrong_doc_type') {
                                    initialReasons = ['Multiple documents found']
                                  } else if (row.comparison?.review_reason === 'unreadable') {
                                    initialReasons = ['Document extraction failed']
                                  }
                                  if (initialReasons.length) {
                                    initialNote = initialReasons.join('; ')
                                  }
                                }
                                setComparisonForms(prev => ({
                                  ...prev,
                                  [id]: {
                                    ...compForm,
                                    status: nextStatus,
                                    reasons: initialReasons,
                                    note: nextStatus === 'UNABLE_TO_VERIFY' ? initialNote : compForm.note,
                                  },
                                }))
                              }}
                            >
                              <option value="">Choose a decision...</option>
                              <option value="OK">OK — Verified no defect</option>
                              <option value="MISMATCH">MISMATCH — Confirmed defect</option>
                              <option value="UNABLE_TO_VERIFY">UNABLE TO VERIFY — Required document unavailable</option>
                            </select>
                          </label>

                          {compForm.status === 'UNABLE_TO_VERIFY' && (
                            <fieldset className="review">
                              <legend>Reason</legend>
                              <div className="field-choices" style={{ display: 'grid', gap: '8px' }}>
                                {UNABLE_TO_VERIFY_REASONS.map(reason => {
                                  const isChecked = compForm.reasons.includes(reason)
                                  return (
                                    <label
                                      key={reason}
                                      className="choice"
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        cursor: 'pointer',
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={e => {
                                          const checked = e.target.checked
                                          let nextReasons = checked
                                            ? [...compForm.reasons, reason]
                                            : compForm.reasons.filter(r => r !== reason)

                                          if (reason === 'SI and BL documents missing' && checked) {
                                            nextReasons = nextReasons.filter(
                                              r => r !== 'SI document missing' && r !== 'BL document missing'
                                            )
                                          } else if (
                                            (reason === 'SI document missing' || reason === 'BL document missing') &&
                                            checked
                                          ) {
                                            nextReasons = nextReasons.filter(
                                              r => r !== 'SI and BL documents missing'
                                            )
                                          }

                                          const activeReasons = nextReasons.filter(r => r !== 'Other')
                                          if (nextReasons.includes('Other') && compForm.otherReason.trim()) {
                                            activeReasons.push(compForm.otherReason.trim())
                                          }
                                          const noteText = activeReasons.join('; ')

                                          setComparisonForms(prev => ({
                                            ...prev,
                                            [id]: {
                                              ...compForm,
                                              reasons: nextReasons,
                                              note: noteText,
                                            },
                                          }))
                                        }}
                                      />
                                      <span>{reason}</span>
                                    </label>
                                  )
                                })}
                              </div>

                              {compForm.reasons.includes('Other') && (
                                <div style={{ marginTop: '10px' }}>
                                  <label>
                                    Specify other reason
                                    <input
                                      type="text"
                                      required
                                      placeholder="Details on why document is unavailable..."
                                      value={compForm.otherReason}
                                      onChange={e => {
                                        const val = e.target.value
                                        const activeReasons = compForm.reasons.filter(r => r !== 'Other')
                                        if (val.trim()) activeReasons.push(val.trim())
                                        setComparisonForms(prev => ({
                                          ...prev,
                                          [id]: {
                                            ...compForm,
                                            otherReason: val,
                                            note: activeReasons.join('; '),
                                          },
                                        }))
                                      }}
                                    />
                                  </label>
                                </div>
                              )}
                            </fieldset>
                          )}

                          {compForm.status === 'MISMATCH' && (
                            <fieldset className="review">
                              <legend>Select Defective Fields:</legend>
                              <div className="field-choices">
                                {checkedFields.map(field => (
                                  <label key={field} className="choice">
                                    <input
                                      type="checkbox"
                                      checked={compForm.fields.includes(field)}
                                      onChange={e =>
                                        setComparisonForms(prev => ({
                                          ...prev,
                                          [id]: {
                                            ...compForm,
                                            fields: e.target.checked
                                              ? [...compForm.fields, field]
                                              : compForm.fields.filter(f => f !== field),
                                          },
                                        }))
                                      }
                                    />
                                    {fieldTitles[field] || field}
                                  </label>
                                ))}
                              </div>
                            </fieldset>
                          )}

                          {compForm.status !== 'UNABLE_TO_VERIFY' && (
                            <label>
                              Decision Note
                              <input
                                required
                                placeholder="Explanation of verified values"
                                value={compForm.note}
                                onChange={e =>
                                  setComparisonForms(prev => ({
                                    ...prev,
                                    [id]: { ...compForm, note: e.target.value },
                                  }))
                                }
                              />
                            </label>
                          )}

                          <div className="pipeline-actions" style={{ marginTop: '12px' }}>
                            <button
                              disabled={
                                !compForm.status ||
                                (compForm.status === 'MISMATCH' && (!compForm.fields.length || !compForm.note.trim())) ||
                                (compForm.status === 'OK' && !compForm.note.trim()) ||
                                (compForm.status === 'UNABLE_TO_VERIFY' &&
                                  (!compForm.reasons.length ||
                                    (compForm.reasons.includes('Other') && !compForm.otherReason.trim())))
                              }
                            >
                              <Icon name="check" /> Save Decision
                            </button>
                            {editingComparisonId === id && (
                              <button
                                type="button"
                                className="secondary"
                                onClick={() => setEditingComparisonId(null)}
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        </form>
                      ) : (
                        <div
                          className="decision"
                          style={{
                            background: '#f4fbf7',
                            padding: '12px',
                            border: '1px solid #bce6cd',
                            borderRadius: '6px',
                            marginTop: '10px',
                          }}
                        >
                          <div>
                            <Icon name="check" />
                            <strong>Decision:</strong>{' '}
                            <span
                              className={`badge ${
                                row.comparisonDecision!.status === 'OK'
                                  ? 'green'
                                  : row.comparisonDecision!.status === 'MISMATCH'
                                  ? 'red'
                                  : 'amber'
                              }`}
                            >
                              {row.comparisonDecision!.status === 'UNABLE_TO_VERIFY'
                                ? 'UNABLE TO VERIFY'
                                : row.comparisonDecision!.status}
                            </span>{' '}
                            — {row.comparisonDecision!.note}
                            {row.comparisonDecision!.fields.length > 0 && (
                              <span>
                                {' '}
                                (Defects:{' '}
                                {row.comparisonDecision!.fields
                                  .map(f => fieldTitles[f] || f)
                                  .join(', ')}
                                )
                              </span>
                            )}
                          </div>
                          <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                            <button
                              type="button"
                              className="secondary"
                              style={{ minHeight: '32px', fontSize: '11px' }}
                              onClick={() => {
                                setEditingComparisonId(id)
                                const d = row.comparisonDecision!
                                const isUn = d.status === 'UNABLE_TO_VERIFY'
                                const rs = d.reasons ?? (isUn && d.note ? [d.note] : [])
                                const hasOth = isUn && rs.some(r => !UNABLE_TO_VERIFY_REASONS.includes(r as any))
                                setComparisonForms(prev => ({
                                  ...prev,
                                  [id]: {
                                    status: d.status,
                                    fields: d.fields,
                                    note: d.note,
                                    reasons: rs,
                                    otherReason: hasOth ? d.note : '',
                                  },
                                }))
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              style={{ minHeight: '32px', fontSize: '11px' }}
                              onClick={() => clearComparisonDecision(id)}
                            >
                              Re-open
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
