import type { HealthInfo } from '@studio/shared'
import { createResource, Show } from 'solid-js'

export default function App() {
  const [health] = createResource(() => window.studio.app.health())

  return (
    <div class="app">
      <header class="app-header">
        <div class="app-title">OpenCode Agent Studio</div>
      </header>
      <main class="app-main">
        <Show when={health()} fallback={<div class="muted">Connecting to main process…</div>}>
          {(info: () => HealthInfo) => (
            <section class="health-card" data-testid="health">
              <h2>Secure IPC bridge online</h2>
              <dl>
                <dt>App</dt>
                <dd>
                  {info().appName} {info().appVersion}
                </dd>
                <dt>Platform</dt>
                <dd>
                  {info().platform} / {info().arch}
                </dd>
                <dt>Electron</dt>
                <dd>{info().electronVersion}</dd>
                <dt>Node</dt>
                <dd>{info().nodeVersion}</dd>
                <dt>Bridge check</dt>
                <dd>{new Date(info().timestamp).toLocaleTimeString()}</dd>
              </dl>
            </section>
          )}
        </Show>
      </main>
    </div>
  )
}
