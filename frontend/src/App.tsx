import { useEffect, useState } from 'react'
import { getHealth } from './lib/api'
import './App.css'

type ApiState =
  | { status: 'loading' }
  | { status: 'connected'; service: string }
  | { status: 'error' }

function App() {
  const [api, setApi] = useState<ApiState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 10000)
    let active = true
    getHealth(controller.signal)
      .then((health) => {
        if (active) setApi({ status: 'connected', service: health.service })
      })
      .catch(() => {
        if (active) setApi({ status: 'error' })
      })
      .finally(() => window.clearTimeout(timeout))
    return () => {
      active = false
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [])

  return (
    <main>
      <p className="eyebrow">React + FastAPI</p>
      <h1>PromptTroopersHack</h1>
      <p>Your project is ready to build on.</p>
      <section className="status-card" aria-labelledby="status-heading">
        <h2 id="status-heading">Backend connection</h2>
        <div role="status" aria-live="polite">
          {api.status === 'loading' && <p>Connecting to the API…</p>}
          {api.status === 'connected' && <p className="success">Connected to {api.service}.</p>}
          {api.status === 'error' && (
            <p>Could not reach the API. Start the backend on port 8000, check the proxy target, and reload this page.</p>
          )}
        </div>
      </section>
    </main>
  )
}

export default App
