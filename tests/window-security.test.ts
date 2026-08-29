import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

test('desktop window keeps the renderer sandboxed and rejects untrusted navigation', async () => {
  const source = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  assert.match(source, /contextIsolation: true/)
  assert.match(source, /nodeIntegration: false/)
  assert.match(source, /sandbox: true/)
  assert.match(source, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/)
  assert.match(source, /webContents\.on\('will-navigate', \(event\) => event\.preventDefault\(\)\)/)
  assert.match(source, /app\.whenReady\(\)\.then\(async \(\) => \{/)
  assert.match(source, /\.catch\(\(error: unknown\) => \{[\s\S]*dialog\.showErrorBox\('Work Buddy could not start'/)
})
