import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from './components/Icon'
import { ClassificationWorkspace } from './features/ClassificationWorkspace'
import { ExtractionWorkspace } from './features/ExtractionWorkspace'
import { ComparisonWorkspace } from './features/ComparisonWorkspace'
import { ReportWorkspace } from './features/ReportWorkspace'
import { UploadView } from './features/UploadView'
import { ClassificationView } from './features/ClassificationView'
import { ResultsView } from './features/ResultsView'
import { ReviewView } from './features/ReviewView'
import type { ExtractionResult } from './lib/api'
import {
  loadExtractionHistory,
  rememberExtraction,
  saveExtractionHistory,
  type ExtractionHistory,
  type SavedExtraction,
} from './lib/extractionHistory'
import { usePipelineState } from './lib/usePipelineState'
import './App.css'

export type View = 'upload' | 'classification' | 'results' | 'review' | 'debug'

// Debug tools accept raw stage inputs and expose diagnostic output. Keep them
// available during local development, but do not ship their UI in production.
const DEBUG_ENABLED = import.meta.env.DEV

const stages: {
  name: string
  icon: IconName
  description: string
  input: string
  output: string
  detail: string
}[] = [
  {
    name: 'Classification',
    icon: 'inbox',
    description: 'Understand the email intent',
    input: 'Email subject, current message, and attachment filenames.',
    output: 'Category, supporting evidence, audit findings, and human-review questions.',
    detail:
      'Identifies comparison requests, SI requests, invoice queries, general messages, and spam. Only comparison requests continue to document processing.',
  },
  {
    name: 'Extraction',
    icon: 'file',
    description: 'Read the shipment details',
    input: 'Shipping Instruction and draft Bill of Lading attachments.',
    output: 'Seven corresponding shipment fields with source evidence.',
    detail:
      'Read shipper, consignee, notify party, loading port, discharge port, container count, and gross weight in kilograms. Missing or unreadable data will require review.',
  },
  {
    name: 'Comparison',
    icon: 'compare',
    description: 'Check SI against draft BL',
    input: 'Extracted SI and BL fields, with the raw document text where available.',
    output: 'Field-by-field matches and discrepancies, with SI and BL values side by side.',
    detail:
      'Uses the SI as the reference. Equivalent labels and formatting are normalised first, so only meaningful differences are reported. Anything it cannot decide is escalated rather than guessed.',
  },
  {
    name: 'Report',
    icon: 'report',
    description: 'Prepare submission JSON',
    input: 'Classifications, comparison results, and human decisions.',
    output: 'Per-email category, status, review reason, and defective fields.',
    detail: 'Build a JSON submission from completed workflow results.',
  },
]

const implemented = new Set([0, 1, 2, 3])

const viewFromHash = (current: View = 'upload'): View => {
  const hash = window.location.hash
  if (DEBUG_ENABLED && hash.startsWith('#debug')) return 'debug'
  if (hash.startsWith('#classification')) return 'classification'
  if (hash.startsWith('#results')) return 'results'
  if (hash.startsWith('#review')) return 'review'
  if (hash.startsWith('#upload')) return 'upload'
  if (hash.startsWith('#pipeline')) return 'upload'
  return current
}

function App() {
  const [view, setView] = useState<View>(() => viewFromHash())
  const [targetReviewId, setTargetReviewId] = useState<string | null>(null)
  const [history, setHistory] = useState<ExtractionHistory>(() => {
    try {
      return loadExtractionHistory(window.localStorage)
    } catch {
      return {
        entries: [],
        warning: 'Browser storage is unavailable. Extractions will be kept for this session only.',
      }
    }
  })
  const historyRef = useRef(history)

  const handleNavigate = useCallback((targetView: View, emailId?: string) => {
    setView(targetView)
    if (targetView === 'review' && emailId) {
      setTargetReviewId(emailId)
    }
  }, [])

  const saveExtraction = useCallback(
    (result: ExtractionResult, source: SavedExtraction['source']) => {
      const entries = rememberExtraction(historyRef.current.entries, result, source)
      let next: ExtractionHistory
      try {
        next = saveExtractionHistory(window.localStorage, entries)
      } catch {
        next = {
          entries,
          warning:
            'Browser storage is unavailable. Download extraction JSON to keep these results after leaving.',
        }
      }
      historyRef.current = next
      setHistory(next)
    },
    []
  )

  const pipeline = usePipelineState({ onSaveExtraction: saveExtraction })
  const [stage, setStage] = useState(0)

  useEffect(() => {
    const sync = () => setView(current => viewFromHash(current))
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  const selected = stages[stage]

  const viewHeadings: Record<View, { eyebrow: string; title: string; subtitle: string }> = {
    upload: {
      eyebrow: 'Stage 01 · Intake',
      title: 'Upload shipment bundle',
      subtitle: 'Upload a ZIP archive to start email categorization and verification.',
    },
    classification: {
      eyebrow: 'Stage 02 · Classification',
      title: 'Email classification',
      subtitle: 'Categorize incoming emails and inspect AI classification evidence.',
    },
    results: {
      eyebrow: 'Stage 03 · Results',
      title: 'Extraction & comparison',
      subtitle: 'Side-by-side comparison of shipping instructions and draft bills of lading.',
    },
    review: {
      eyebrow: 'Stage 04 · Human-in-the-Loop',
      title: 'Human review queue',
      subtitle: 'Resolve edge cases, ambiguous categories, and document discrepancy alerts.',
    },
    debug: {
      eyebrow: 'Developer workspace',
      title: 'Debug mode',
      subtitle: 'Test one stage at a time. Inspect the input, output, and decisions.',
    },
  }

  const currentHeading = viewHeadings[view]

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to workspace
      </a>
      <aside className="sidebar">
        <a href="#upload" className="brand" onClick={() => handleNavigate('upload')}>
          <span className="brand-symbol">
            <Icon name="shield" />
          </span>
          <span>
            Prompt Troopers<small>SHIPPING OPERATIONS</small>
          </span>
        </a>

        <div className="nav-label">PIPELINE WORKFLOW</div>
        <nav aria-label="Pipeline stages" className="sidebar-nav">
          <a
            href="#upload"
            aria-current={view === 'upload' ? 'page' : undefined}
            onClick={() => handleNavigate('upload')}
          >
            <Icon name="upload" />
            <span className="nav-text">Upload</span>
            <span className="nav-arrow">→</span>
          </a>
          <a
            href="#classification"
            aria-current={view === 'classification' ? 'page' : undefined}
            onClick={() => handleNavigate('classification')}
          >
            <Icon name="inbox" />
            <span className="nav-text">Classification</span>
            {pipeline.rows.length > 0 && (
              <span className="nav-badge subtle-badge">{pipeline.rows.length}</span>
            )}
            <span className="nav-arrow">→</span>
          </a>
          <a
            href="#results"
            aria-current={view === 'results' ? 'page' : undefined}
            onClick={() => handleNavigate('results')}
          >
            <Icon name="compare" />
            <span className="nav-text">Results</span>
            <span className="nav-arrow">→</span>
          </a>
          <a
            href="#review"
            aria-current={view === 'review' ? 'page' : undefined}
            onClick={() => handleNavigate('review')}
            className={pipeline.reviewCount > 0 ? 'nav-has-pending' : ''}
          >
            <Icon name="user" />
            <span className="nav-text">Human Review</span>
            {pipeline.reviewCount > 0 && (
              <span className="nav-badge amber-badge">{pipeline.reviewCount}</span>
            )}
            <span className="nav-arrow">→</span>
          </a>
        </nav>

        {DEBUG_ENABLED && (
          <div className="debug-section">
            <div className="nav-label" style={{ marginTop: '32px' }}>
              DEVELOPER
            </div>
            <nav aria-label="Developer tools">
              <a
                href="#debug"
                aria-current={view === 'debug' ? 'page' : undefined}
                onClick={() => handleNavigate('debug')}
              >
                <Icon name="code" />
                <span className="nav-text">Debug mode</span>
              </a>
            </nav>
          </div>
        )}
      </aside>

      <div className="main-shell">
        <main id="main-content">
          <header className="page-heading">
            <div>
              <p className="eyebrow">{currentHeading.eyebrow}</p>
              <h1>{currentHeading.title}</h1>
              <p>{currentHeading.subtitle}</p>
            </div>
            <span className="version-tag">
              VERSION <span>v0.1</span>
            </span>
          </header>

          <div hidden={view !== 'upload'}>
            <UploadView pipeline={pipeline} onNavigate={handleNavigate} />
          </div>

          <div hidden={view !== 'classification'}>
            <ClassificationView pipeline={pipeline} onNavigate={handleNavigate} />
          </div>

          <div hidden={view !== 'results'}>
            <ResultsView pipeline={pipeline} onNavigate={handleNavigate} />
          </div>

          <div hidden={view !== 'review'}>
            <ReviewView
              pipeline={pipeline}
              targetId={targetReviewId}
              onNavigate={handleNavigate}
              onClearTarget={() => setTargetReviewId(null)}
            />
          </div>

          {DEBUG_ENABLED && (
            <div hidden={view !== 'debug'}>
              <div className="debug-notice">
                <Icon name="code" />
                <div>
                  <strong>Independent stage testing</strong>
                  <p>
                    Debug results stay in this workspace and do not change the main pipeline
                    queue.
                  </p>
                </div>
              </div>
              <div className="debug-layout">
                <nav className="stage-picker" aria-label="Debug stages">
                  {stages.map((item, index) => (
                    <button
                      key={item.name}
                      className={stage === index ? 'selected' : ''}
                      aria-pressed={stage === index}
                      onClick={() => setStage(index)}
                    >
                      <Icon name={item.icon} />
                      <span>
                        {item.name}
                        <small>
                          {implemented.has(index) ? 'Available for testing' : 'Not implemented'}
                        </small>
                      </span>
                      <span>0{index + 1}</span>
                    </button>
                  ))}
                </nav>
                <div className="debug-content">
                  <div hidden={stage !== 0}>
                    <ClassificationWorkspace debug />
                  </div>
                  <div hidden={stage !== 1}>
                    <ExtractionWorkspace
                      onSaveExtraction={saveExtraction}
                      storageWarning={history.warning}
                    />
                  </div>
                  <div hidden={stage !== 2}>
                    <ComparisonWorkspace
                      debug
                      savedExtractions={history.entries}
                      storageWarning={history.warning}
                    />
                  </div>
                  <div hidden={stage !== 3}>
                    <ReportWorkspace debug />
                  </div>
                  {!implemented.has(stage) && (
                    <section className="panel planned-stage">
                      <span className="planned-icon">
                        <Icon name={selected.icon} />
                      </span>
                      <span className="badge neutral">Not implemented</span>
                      <h2>{selected.name} test bench</h2>
                      <p>{selected.detail}</p>
                      <dl>
                        <div>
                          <dt>Expected input</dt>
                          <dd>{selected.input}</dd>
                        </div>
                        <div>
                          <dt>Expected output</dt>
                          <dd>{selected.output}</dd>
                        </div>
                      </dl>
                      <div className="availability-note">
                        <Icon name="info" />
                        <p>
                          This stage has no processing endpoint yet. Independent testing will be
                          available when it is implemented.
                        </p>
                      </div>
                      <button disabled>
                        <Icon name="play" />
                        Run {selected.name.toLowerCase()} test
                      </button>
                    </section>
                  )}
                </div>
              </div>
            </div>
          )}

          {history.warning && (
            <p className="error" role="status" style={{ marginTop: '20px' }}>
              {history.warning}
            </p>
          )}

          <footer className="page-footer">
            <span>Prompt Troopers · Shipping document verification</span>
          </footer>
        </main>
      </div>
    </div>
  )
}

export default App
