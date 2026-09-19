/** Minimal SSE `data:` line parser over a fetch body stream. */
export async function* sseDataLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '')
        buffer = buffer.slice(newlineIndex + 1)
        if (line.startsWith('data:')) {
          yield line.slice(5).trim()
        }
        newlineIndex = buffer.indexOf('\n')
      }
    }
  } finally {
    reader.releaseLock()
  }
}
