import http from 'node:http'
http.get('http://127.0.0.1:9223/json', (res) => {
  let d = ''
  res.on('data', (c) => (d += c))
  res.on('end', () => {
    const ws = new WebSocket(JSON.parse(d)[0].webSocketDebuggerUrl)
    let seq = 0
    const pending = new Map()
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data))
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m.result)
        pending.delete(m.id)
      }
    })
    ws.addEventListener('open', async () => {
      const send = (method, params = {}) =>
        new Promise((resolve) => {
          const id = ++seq
          pending.set(id, resolve)
          ws.send(JSON.stringify({ id, method, params }))
        })
      await send('Runtime.enable')

      const install = `(() => {
        window.__evLog = []
        window.__evT0 = Date.now()
        window.studio.chat.onEvent((e) => {
          window.__evLog.push({
            at: Date.now() - window.__evT0,
            type: e.type,
            status: e.status ?? null,
            text: (e.text ?? '').slice(0, 30),
          })
        })
        return 'installed'
      })()`

      console.log('install:', JSON.stringify(await send('Runtime.evaluate', { expression: install, returnByValue: true }).then((r) => r.result?.value)))

      const active = (
        await send('Runtime.evaluate', {
          expression: `(async () => window.studio.projects.tabState())()`,
          awaitPromise: true,
          returnByValue: true,
        })
      ).result?.value?.activeProjectId
      console.log('active:', active?.slice(0, 8))

      await send('Runtime.evaluate', {
        expression: `(async () => window.studio.chat.send(${JSON.stringify(active)}, 'What is 5+5? Just the number.'))()`,
        awaitPromise: true,
        returnByValue: true,
      })

      await new Promise((r) => setTimeout(r, 15_000))

      const dump = await send('Runtime.evaluate', {
        expression: `window.__evLog.map((e) => '+' + e.at + 'ms ' + e.type + (e.status ? ' ' + e.status : '') + (e.text ? ' [' + e.text + ']' : '')).join('\\n')`,
        returnByValue: true,
      })
      console.log(String(dump.result?.value ?? '(empty)'))
      process.exit(0)
    })
  })
})
