import { createMemo, createSignal } from 'solid-js'
import { it } from 'vitest'

it('solid memo reactivity in node', () => {
  const [s, setS] = createSignal(false)
  let evals = 0
  const memo = createMemo(() => {
    evals += 1
    return s() ? 'yes' : 'no'
  })
  console.log('initial:', memo(), 'evals:', evals)
  setS(true)
  console.log('after set read:', memo(), 'evals:', evals)
})
