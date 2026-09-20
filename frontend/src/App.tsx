import { useEffect, useState } from 'react'
import { Icon, type IconName } from './components/Icon'
import { ClassificationWorkspace } from './features/ClassificationWorkspace'
import { ExtractionWorkspace } from './features/ExtractionWorkspace'
import './App.css'

type View = 'pipeline' | 'debug'
const stages: { name: string; icon: IconName; description: string; input: string; output: string; detail: string }[] = [
  { name: 'Classification', icon: 'inbox', description: 'Understand the email intent', input: 'Email subject, current message, and attachment filenames.', output: 'Category, supporting evidence, audit findings, and human-review questions.', detail: 'Identifies comparison requests, SI requests, invoice queries, general messages, and spam. Only comparison requests continue to document processing.' },
  { name: 'Extraction', icon: 'file', description: 'Read the shipment details', input: 'Shipping Instruction and draft Bill of Lading attachments.', output: 'Seven corresponding shipment fields with source evidence.', detail: 'Read shipper, consignee, notify party, loading port, discharge port, container count, and gross weight in kilograms. Missing or unreadable data will require review.' },
  { name: 'Comparison', icon: 'compare', description: 'Check SI against draft BL', input: 'Extracted SI and BL fields with their source evidence.', output: 'Field-by-field matches and discrepancies, with SI and BL values side by side.', detail: 'Use the SI as the reference. Normalize equivalent labels and formatting before identifying meaningful differences.' },
  { name: 'Report', icon: 'report', description: 'Make every finding actionable', input: 'Comparison results and resolved human-review decisions.', output: 'A discrepancy report or “No mismatch detected” after all seven fields are checked.', detail: 'Show the checked email, affected fields, source values, and outstanding decisions. Classification results can already be exported separately.' },
]
const viewFromHash = (current: View = 'pipeline'): View => window.location.hash.startsWith('#debug') ? 'debug' : window.location.hash.startsWith('#pipeline') ? 'pipeline' : current
function App() {
  const [view, setView] = useState<View>(() => viewFromHash())
  const [stage, setStage] = useState(0)
  useEffect(() => { const sync = () => setView(current => viewFromHash(current)); window.addEventListener('hashchange', sync); return () => window.removeEventListener('hashchange', sync) }, [])
  const selected = stages[stage]
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to workspace</a>
    <aside className="sidebar">
      <a href="#pipeline" className="brand"><span className="brand-symbol"><Icon name="shield"/></span><span>Prompt Troopers<small>SHIPPING OPERATIONS</small></span></a>
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label="Workspace"><a href="#pipeline" aria-current={view === 'pipeline' ? 'page' : undefined}><Icon name="grid"/>Pipeline<span className="nav-arrow">→</span></a><a href="#debug" aria-current={view === 'debug' ? 'page' : undefined}><Icon name="code"/>Debug mode</a></nav>
      <div className="sidebar-roadmap"><div className="nav-label">BUILD PROGRESS</div>{stages.map((item, index) => <div key={item.name}><span className={index === 0 ? 'roadmap-dot ready' : 'roadmap-dot'}/><span>{item.name}</span><small>{index < 2 ? 'Ready' : 'Planned'}</small></div>)}</div>
      <div className="sidebar-footer"><span className="environment-dot"/>Development workspace<p>Built for clearer decisions.<br/>One shipment at a time.</p></div>
    </aside>
    <div className="main-shell">
      <div className="topbar"><span>Workspace <span className="breadcrumb">/</span> <strong>{view === 'pipeline' ? 'Shipping verification' : 'Stage diagnostics'}</strong></span><span className="environment">POC · Local session</span></div>
      <main id="main-content">
        <header className="page-heading"><div><p className="eyebrow">{view === 'pipeline' ? 'From inbox to discrepancy report' : 'Developer workspace'}</p><h1>{view === 'pipeline' ? 'Shipping verification' : 'Debug mode'}</h1><p>{view === 'pipeline' ? 'Every request, every document, every detail — in one workflow.' : 'Test one stage at a time. Inspect the input, output, and decisions.'}</p></div><span className="version-tag">EARLY ACCESS <span>v0.1</span></span></header>
        <div hidden={view !== 'pipeline'}>
          <section className="pipeline-map" aria-label="Verification pipeline">
            <div className="section-heading"><h2>The verification pipeline</h2><span className="subtle">2 of 4 stages implemented</span></div>
            <ol>{stages.map((item, index) => <li key={item.name}><div className={`stage-icon ${index < 2 ? 'active' : ''}`}><Icon name={item.icon}/></div><div><div className="stage-label"><span>0{index + 1}</span><strong>{item.name}</strong></div><p>{item.description}</p><span className={`badge ${index < 2 ? 'green' : 'neutral'}`}>{index < 2 ? 'Ready to run' : 'Not implemented'}</span></div>{index < 3 && <span className="stage-arrow"><Icon name="arrow"/></span>}</li>)}</ol>
            <div className="pipeline-note"><Icon name="info"/><span>Only document-comparison requests continue beyond classification. Uncertain decisions go to human review.</span><a href="#debug">Test a stage <Icon name="arrow"/></a></div>
          </section>
          <ClassificationWorkspace/>
        </div>
        <div hidden={view !== 'debug'}>
          <div className="debug-notice"><Icon name="code"/><div><strong>Independent stage testing</strong><p>Debug results stay in this workspace and do not change the main pipeline queue.</p></div></div>
          <div className="debug-layout">
            <nav className="stage-picker" aria-label="Debug stages">{stages.map((item, index) => <button key={item.name} className={stage === index ? 'selected' : ''} aria-pressed={stage === index} onClick={() => setStage(index)}><Icon name={item.icon}/><span>{item.name}<small>{index < 2 ? 'Available for testing' : 'Not implemented'}</small></span><span>0{index + 1}</span></button>)}</nav>
            <div className="debug-content">
              <div hidden={stage !== 0}><ClassificationWorkspace debug/></div>
              <div hidden={stage !== 1}><ExtractionWorkspace/></div>
              {stage > 1 && <section className="panel planned-stage"><span className="planned-icon"><Icon name={selected.icon}/></span><span className="badge neutral">Not implemented</span><h2>{selected.name} test bench</h2><p>{selected.detail}</p><dl><div><dt>Expected input</dt><dd>{selected.input}</dd></div><div><dt>Expected output</dt><dd>{selected.output}</dd></div></dl><div className="availability-note"><Icon name="info"/><p>This stage has no processing endpoint yet. Independent testing will be available when it is implemented.</p></div><button disabled><Icon name="play"/>Run {selected.name.toLowerCase()} test</button></section>}
            </div>
          </div>
        </div>
        <footer className="page-footer"><span>Prompt Troopers · Shipping document verification</span><span>SI is the source of truth.</span></footer>
      </main>
    </div>
  </div>
}
export default App
