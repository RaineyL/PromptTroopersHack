import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from './components/Icon'
import { ClassificationWorkspace } from './features/ClassificationWorkspace'
import { ExtractionWorkspace } from './features/ExtractionWorkspace'
import { ComparisonWorkspace } from './features/ComparisonWorkspace'
import { ReportWorkspace } from './features/ReportWorkspace'
import { PipelineDashboard } from './features/PipelineDashboard'
import type { ExtractionResult } from './lib/api'
import { loadExtractionHistory, rememberExtraction, saveExtractionHistory, type ExtractionHistory, type SavedExtraction } from './lib/extractionHistory'
import './App.css'

type View = 'pipeline' | 'debug'
// Debug tools accept raw stage inputs and expose diagnostic output. Keep them
// available during local development, but do not ship their UI in production.
const DEBUG_ENABLED = import.meta.env.DEV
const stages: { name: string; icon: IconName; description: string; input: string; output: string; detail: string }[] = [
  { name: 'Classification', icon: 'inbox', description: 'Understand the email intent', input: 'Email subject, current message, and attachment filenames.', output: 'Category, supporting evidence, audit findings, and human-review questions.', detail: 'Identifies comparison requests, SI requests, invoice queries, general messages, and spam. Only comparison requests continue to document processing.' },
  { name: 'Extraction', icon: 'file', description: 'Read the shipment details', input: 'Shipping Instruction and draft Bill of Lading attachments.', output: 'Seven corresponding shipment fields with source evidence.', detail: 'Read shipper, consignee, notify party, loading port, discharge port, container count, and gross weight in kilograms. Missing or unreadable data will require review.' },
  { name: 'Comparison', icon: 'compare', description: 'Check SI against draft BL', input: 'Extracted SI and BL fields, with the raw document text where available.', output: 'Field-by-field matches and discrepancies, with SI and BL values side by side.', detail: 'Uses the SI as the reference. Equivalent labels and formatting are normalised first, so only meaningful differences are reported. Anything it cannot decide is escalated rather than guessed.' },
  { name: 'Report', icon: 'report', description: 'Prepare submission JSON', input: 'Classifications, comparison results, and human decisions.', output: 'Per-email category, status, review reason, and defective fields.', detail: 'Build a JSON submission from completed workflow results.' },
]
const implemented = new Set([0, 1, 2, 3])
const viewFromHash = (current: View = 'pipeline'): View => DEBUG_ENABLED && window.location.hash.startsWith('#debug') ? 'debug' : window.location.hash.startsWith('#pipeline') ? 'pipeline' : current
function App() {
  const [view, setView] = useState<View>(() => viewFromHash())
  const [history, setHistory] = useState<ExtractionHistory>(() => {
    try { return loadExtractionHistory(window.localStorage) }
    catch { return { entries: [], warning: 'Browser storage is unavailable. Extractions will be kept for this session only.' } }
  })
  const historyRef = useRef(history)
  const saveExtraction = useCallback((result: ExtractionResult, source: SavedExtraction['source']) => {
    const entries = rememberExtraction(historyRef.current.entries, result, source)
    let next: ExtractionHistory
    try { next = saveExtractionHistory(window.localStorage, entries) }
    catch { next = { entries, warning: 'Browser storage is unavailable. Download extraction JSON to keep these results after leaving.' } }
    historyRef.current = next
    setHistory(next)
  }, [])
  const [stage, setStage] = useState(0)
  useEffect(() => { const sync = () => setView(current => viewFromHash(current)); window.addEventListener('hashchange', sync); return () => window.removeEventListener('hashchange', sync) }, [])
  const selected = stages[stage]
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to workspace</a>
    <aside className="sidebar">
      <a href="#pipeline" className="brand"><span className="brand-symbol"><Icon name="shield"/></span><span>Prompt Troopers<small>SHIPPING OPERATIONS</small></span></a>
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label="Workspace"><a href="#pipeline" aria-current={view === 'pipeline' ? 'page' : undefined}><Icon name="grid"/>Pipeline<span className="nav-arrow">→</span></a>{DEBUG_ENABLED && <a href="#debug" aria-current={view === 'debug' ? 'page' : undefined}><Icon name="code"/>Debug mode</a>}</nav>
    </aside>
    <div className="main-shell">
      <main id="main-content">
        <header className="page-heading"><div><p className="eyebrow">{view === 'pipeline' ? 'From inbox to discrepancy report' : 'Developer workspace'}</p><h1>{view === 'pipeline' ? 'Shipping verification' : 'Debug mode'}</h1><p>{view === 'pipeline' ? 'Every request, every document, every detail — in one workflow.' : 'Test one stage at a time. Inspect the input, output, and decisions.'}</p></div><span className="version-tag">VERSION <span>v0.1</span></span></header>
        <div hidden={view !== 'pipeline'}>
          <PipelineDashboard onSaveExtraction={saveExtraction}/>
          {history.warning && <p className="error" role="status">{history.warning}</p>}
        </div>
        {DEBUG_ENABLED && <div hidden={view !== 'debug'}>
          <div className="debug-notice"><Icon name="code"/><div><strong>Independent stage testing</strong><p>Debug results stay in this workspace and do not change the main pipeline queue.</p></div></div>
          <div className="debug-layout">
            <nav className="stage-picker" aria-label="Debug stages">{stages.map((item, index) => <button key={item.name} className={stage === index ? 'selected' : ''} aria-pressed={stage === index} onClick={() => setStage(index)}><Icon name={item.icon}/><span>{item.name}<small>{implemented.has(index) ? 'Available for testing' : 'Not implemented'}</small></span><span>0{index + 1}</span></button>)}</nav>
            <div className="debug-content">
              <div hidden={stage !== 0}><ClassificationWorkspace debug/></div>
              <div hidden={stage !== 1}><ExtractionWorkspace onSaveExtraction={saveExtraction} storageWarning={history.warning}/></div>
              <div hidden={stage !== 2}><ComparisonWorkspace debug savedExtractions={history.entries} storageWarning={history.warning}/></div>
              <div hidden={stage !== 3}><ReportWorkspace debug/></div>
              {!implemented.has(stage) && <section className="panel planned-stage"><span className="planned-icon"><Icon name={selected.icon}/></span><span className="badge neutral">Not implemented</span><h2>{selected.name} test bench</h2><p>{selected.detail}</p><dl><div><dt>Expected input</dt><dd>{selected.input}</dd></div><div><dt>Expected output</dt><dd>{selected.output}</dd></div></dl><div className="availability-note"><Icon name="info"/><p>This stage has no processing endpoint yet. Independent testing will be available when it is implemented.</p></div><button disabled><Icon name="play"/>Run {selected.name.toLowerCase()} test</button></section>}
            </div>
          </div>
        </div>}
        <footer className="page-footer"><span>Prompt Troopers · Shipping document verification</span></footer>
      </main>
    </div>
  </div>
}
export default App
