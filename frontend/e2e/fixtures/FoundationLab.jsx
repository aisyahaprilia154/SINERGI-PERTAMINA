import { useState } from 'react'

export function FoundationLab() {
  const [count, setCount] = useState(0)
  const [failed, setFailed] = useState(false)
  if (failed) throw new Error('Foundation fixture render failure')
  return (
    <main>
      <h1>Fondasi React</h1>
      <button onClick={() => setCount(value => value + 1)}>Hitungan {count}</button>
      <button onClick={() => setFailed(true)}>Picu error</button>
      <a href="/">Kembali ke login</a>
    </main>
  )
}
