import { Icon } from '../components/Icon'
import type { PipelineState } from '../lib/usePipelineState'
import type { SubmissionRow } from '../lib/report'

interface UploadViewProps {
  pipeline: PipelineState
  onNavigate: (view: 'classification') => void
}

export function UploadView({ pipeline, onNavigate }: UploadViewProps) {
  const {
    rows,
    filename,
    loading,
    running,
    error,
    load,
    run,
    stop,
    completedCount,
    report,
  } = pipeline

  async function handleFileChange(file: File | undefined) {
    if (!file) return
    const success = await load(file)
    if (success) {
      onNavigate('classification')
    }
  }

  const reportReviewCount = Object.values(report.submission).filter(
    (item: SubmissionRow) => item.status === 'NEEDS_REVIEW'
  ).length

  return (
    <div className="upload-view">
      <section className="panel pipeline-intake">
        <div>
          <p className="eyebrow">01 · Intake</p>
          <h2>Upload your shipment inbox</h2>
          <p>
            Choose one ZIP containing <code>inbox/*.json</code> and <code>attachments/</code>. The
            archive stays in this backend session for up to four hours.
          </p>
        </div>
        <label className="upload-zone">
          <Icon name="upload" />
          <span>
            <strong>{filename || 'Choose a ZIP bundle'}</strong>
            <small>ZIP · 50 MB compressed maximum · no email-count limit</small>
          </span>
          <input
            type="file"
            accept=".zip,application/zip"
            disabled={loading || running}
            onChange={event => {
              void handleFileChange(event.target.files?.[0])
              event.target.value = ''
            }}
          />
        </label>
        <div className="pipeline-actions">
          <button
            disabled={!rows.length || loading || running}
            onClick={() => void run()}
          >
            <Icon name="play" />
            {running ? 'Running pipeline…' : 'Run pipeline'}
          </button>
          {running && (
            <button className="secondary" onClick={stop}>
              Stop
            </button>
          )}
          {rows.length > 0 && !loading && (
            <button
              className="secondary"
              onClick={() => onNavigate('classification')}
            >
              View emails ({rows.length}) <span className="nav-arrow">→</span>
            </button>
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p className="pipeline-help" role="status">
          {loading
            ? 'Validating ZIP…'
            : running
            ? `Processing: ${rows.filter(row => row.classification || row.error).length} of ${rows.length} classified`
            : rows.length
            ? `${rows.length} emails loaded from ${filename}. ${completedCount} report entries available${
                reportReviewCount
                  ? `, including ${reportReviewCount} requiring a human decision`
                  : ''
              }.`
            : 'Upload a bundle to begin. Classification uses the configured DeepSeek API.'}
        </p>
      </section>

      {rows.length > 0 && (
        <div className="pipeline-stats" aria-label="Upload summary">
          <div>
            <span>Emails</span>
            <strong>{rows.length}</strong>
          </div>
          <div>
            <span>Classified</span>
            <strong>{rows.filter(row => row.classification).length}</strong>
          </div>
          <div>
            <span>Human decision required</span>
            <strong>{pipeline.reviewCount}</strong>
          </div>
          <div>
            <span>Session file</span>
            <strong style={{ fontSize: '15px', wordBreak: 'break-all' }}>{filename}</strong>
          </div>
        </div>
      )}
    </div>
  )
}
