const { spawnSync } = require('node:child_process')
const { resolve } = require('node:path')

const bootstrap = resolve(__dirname, 'tsx-bootstrap.cjs').replaceAll('\\', '/')
const nodeOptions = [process.env.NODE_OPTIONS, `--require="${bootstrap}"`].filter(Boolean).join(' ')
const result = spawnSync(process.execPath, [resolve(__dirname, '../node_modules/tsx/dist/cli.mjs'), '--test', 'tests/**/*.test.ts'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: nodeOptions }
})

process.exitCode = result.status ?? 1
