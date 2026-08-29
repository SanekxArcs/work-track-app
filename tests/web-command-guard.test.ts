import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('web command dispatch has a synchronous in-flight guard', async () => {
  const source = await readFile(new URL('../apps/web/components/Dashboard.tsx', import.meta.url), 'utf8')
  assert.match(source, /const commandInFlight = useRef\(false\)/)
  assert.match(source, /if \(commandInFlight\.current\) return;/)
  assert.match(source, /commandInFlight\.current = true;/)
  assert.match(source, /commandInFlight\.current = false;/)
})
