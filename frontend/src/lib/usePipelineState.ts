import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  classifyEmail,
  compareDocuments,
  runPipelineExtraction,
  uploadInbox,
  type Category,
  type ClassificationResult,
  type ComparisonResult,
  type EmailRecord,
  type ExtractionResult,
} from './api'
import {
  buildSubmission,
  type ReportClassification,
  type ReportComparison,
  type ReportDecision,
  type SubmissionRow,
} from './report'

export type SubmissionReport = {
  submission: Record<string, SubmissionRow>
  issues: string[]
}

export type PipelineRow = {
  email: EmailRecord
  classification?: ClassificationResult
  extraction?: ExtractionResult
  comparison?: ComparisonResult
  categoryDecision?: { category: Category; note: string }
  comparisonDecision?: ReportDecision
  error?: string
  processing?: boolean
}

export const comparisonNeedsDecision = (row: PipelineRow) =>
  !!(
    row.comparison &&
    !row.comparisonDecision &&
    row.comparison.status === 'NEEDS_REVIEW'
  )

export const classificationNeedsDecision = (row: PipelineRow) =>
  !!(row.classification?.classification.needs_human_review && !row.categoryDecision)

export const needsReview = (row: PipelineRow) =>
  classificationNeedsDecision(row) || comparisonNeedsDecision(row)

export function usePipelineState(options?: {
  onSaveExtraction?: (result: ExtractionResult, source: 'Pipeline') => void
}) {
  const [rows, setRows] = useState<PipelineRow[]>([])
  const [sessionId, setSessionId] = useState('')
  const [filename, setFilename] = useState('')
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  const controller = useRef<AbortController | null>(null)
  const rowsRef = useRef(rows)
  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

  useEffect(() => () => controller.current?.abort(), [])

  const changeRows = useCallback((update: (previous: PipelineRow[]) => PipelineRow[]) => {
    setRows(previous => {
      const next = update(previous)
      rowsRef.current = next
      return next
    })
  }, [])

  const updateRow = useCallback((id: string, update: (row: PipelineRow) => PipelineRow) => {
    changeRows(previous =>
      previous.map(row => (row.email.email_id === id ? update(row) : row))
    )
  }, [changeRows])

  const confirmCategory = useCallback((emailId: string, category: Category, note: string) => {
    updateRow(emailId, row => ({
      ...row,
      categoryDecision: { category, note },
      extraction: undefined,
      comparison: undefined,
      comparisonDecision: undefined,
      error: undefined,
    }))
  }, [updateRow])

  const saveComparisonDecision = useCallback((emailId: string, decision: ReportDecision) => {
    updateRow(emailId, row => ({
      ...row,
      comparisonDecision: decision,
    }))
  }, [updateRow])

  const clearComparisonDecision = useCallback((emailId: string) => {
    updateRow(emailId, row => ({
      ...row,
      comparisonDecision: undefined,
    }))
  }, [updateRow])

  async function load(file: File | undefined): Promise<boolean> {
    if (!file || running || loading) return false
    if (!/\.zip$/i.test(file.name) || file.size > 50_000_000) {
      setError('Choose a ZIP file no larger than 50 MB.')
      return false
    }
    const abort = new AbortController()
    controller.current = abort
    setLoading(true)
    setError('')
    try {
      const uploaded = await uploadInbox(file, abort.signal, sessionId)
      setSessionId(uploaded.sessionId)
      setFilename(file.name)
      changeRows(() => uploaded.emails.map(email => ({ email })))
      return true
    } catch (cause) {
      if (!abort.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Could not upload ZIP.')
      }
      return false
    } finally {
      controller.current = null
      setLoading(false)
    }
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
      const category =
        row.categoryDecision?.category ?? row.classification!.classification.category
      if (row.classification!.classification.needs_human_review && !row.categoryDecision) return
      if (category !== 'BL_COMPARISON' || row.comparison) return
      const extraction =
        row.extraction ?? (await runPipelineExtraction(id, signal, sessionId))
      if (!row.extraction) {
        updateRow(id, item => ({ ...item, extraction }))
        options?.onSaveExtraction?.(extraction, 'Pipeline')
      }
      const comparison = (await compareDocuments([extraction], signal)).results[0]
      if (!comparison || comparison.email_id !== id) {
        throw new Error('Comparison returned an unexpected email.')
      }
      updateRow(id, item => ({ ...item, comparison }))
    } catch (cause) {
      if (!signal.aborted) {
        updateRow(id, item => ({
          ...item,
          error: cause instanceof Error ? cause.message : 'Processing failed.',
        }))
      }
    } finally {
      updateRow(id, item => ({ ...item, processing: false }))
    }
  }

  async function run(emailId?: string) {
    if (controller.current || !sessionId) return
    const abort = new AbortController()
    controller.current = abort
    setRunning(true)
    setError('')
    try {
      const queue = emailId
        ? rowsRef.current.filter(row => row.email.email_id === emailId)
        : rowsRef.current
      for (const row of queue) {
        if (abort.signal.aborted) break
        if (
          !row.comparison &&
          (!row.classification ||
            row.categoryDecision ||
            !row.classification.classification.needs_human_review)
        ) {
          await processRow(row.email, abort.signal)
        }
      }
    } finally {
      controller.current = null
      setRunning(false)
    }
  }

  function stop() {
    controller.current?.abort()
  }

  const classifications: ReportClassification[] = useMemo(
    () =>
      rows.map(row => ({
        email_id: row.email.email_id,
        category:
          row.categoryDecision?.category ??
          row.classification?.classification.category ??
          null,
        needs_human_review:
          !row.classification ||
          (row.classification.classification.needs_human_review &&
            !row.categoryDecision),
      })),
    [rows]
  )

  const comparison: ReportComparison = useMemo(
    () => ({
      response: {
        summary: {
          emails: 0,
          ok: 0,
          mismatch: 0,
          needs_review: 0,
          defect_fields: {},
          unpaired_files: [],
        },
        results: rows.flatMap(row => (row.comparison ? [row.comparison] : [])),
      },
      decisions: Object.fromEntries(
        rows.flatMap(row =>
          row.comparisonDecision ? [[row.email.email_id, row.comparisonDecision]] : []
        )
      ),
    }),
    [rows]
  )

  const report: SubmissionReport = useMemo(
    () => buildSubmission(classifications, comparison),
    [classifications, comparison]
  )

  const completedCount = Object.keys(report.submission).length
  const reviewCount = rows.filter(needsReview).length
  const classificationReviewCount = rows.filter(classificationNeedsDecision).length
  const comparisonReviewCount = rows.filter(comparisonNeedsDecision).length

  return {
    rows,
    sessionId,
    filename,
    loading,
    running,
    error,
    setError,
    load,
    run,
    stop,
    updateRow,
    confirmCategory,
    saveComparisonDecision,
    clearComparisonDecision,
    report,
    completedCount,
    reviewCount,
    classificationReviewCount,
    comparisonReviewCount,
  }
}

export type PipelineState = ReturnType<typeof usePipelineState>
