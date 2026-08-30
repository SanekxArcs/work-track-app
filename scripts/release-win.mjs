import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packagePath = resolve(root, 'package.json')
const lockfilePath = resolve(root, 'package-lock.json')
const releaseDirectoryPattern = /^release-v\d+\.\d+\.\d+$/

function usage() {
  console.log('Usage: npm run release:win [patch|minor|major|x.y.z]')
  console.log('Defaults to a patch release and removes previous release-vX.Y.Z folders.')
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value)
  if (!match) throw new Error(`Invalid version: ${value}. Use x.y.z.`)
  return match.slice(1).map(Number)
}

function nextVersion(current, requested) {
  if (/^\d+\.\d+\.\d+$/.test(requested)) return requested
  const [major, minor, patch] = parseVersion(current)
  if (requested === 'major') return `${major + 1}.0.0`
  if (requested === 'minor') return `${major}.${minor + 1}.0`
  if (requested === 'patch') return `${major}.${minor}.${patch + 1}`
  throw new Error(`Unknown release type: ${requested}`)
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function removePreviousReleases() {
  const releaseDirectories = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && releaseDirectoryPattern.test(entry.name))
    .map((entry) => resolve(root, entry.name))

  const lockedDirectories = []
  for (const directory of releaseDirectories) {
    try {
      rmSync(directory, { recursive: true, force: true, maxRetries: 6, retryDelay: 500 })
      console.log(`Removed ${directory}`)
    } catch (error) {
      if (error && typeof error === 'object' && ['EBUSY', 'EPERM'].includes(error.code)) {
        lockedDirectories.push(directory)
        console.warn(`Could not remove locked previous release: ${directory}`)
        continue
      }
      throw error
    }
  }
  return lockedDirectories
}

function run() {
  const argument = process.argv[2]
  if (argument === '--help' || argument === '-h') {
    usage()
    return
  }

  const releaseType = argument ?? 'patch'
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
  const version = nextVersion(packageJson.version, releaseType)
  const output = `release-v${version}`

  // Clean first: a locked old build must not change the project version.
  const lockedReleases = removePreviousReleases()

  packageJson.version = version
  packageJson.build ??= {}
  packageJson.build.directories ??= {}
  packageJson.build.directories.output = output
  writeJson(packagePath, packageJson)

  if (existsSync(lockfilePath)) {
    const lockfile = JSON.parse(readFileSync(lockfilePath, 'utf8'))
    lockfile.version = version
    if (lockfile.packages?.['']) lockfile.packages[''].version = version
    writeJson(lockfilePath, lockfile)
  }

  const command = process.platform === 'win32' ? 'cmd.exe' : 'npm'
  const commandArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm run dist:win']
    : ['run', 'dist:win']
  const build = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit' })
  if (build.error) throw build.error
  if (build.status !== 0) process.exit(build.status ?? 1)

  console.log(`\nWindows release ${version} is ready in ${output}.`)
  if (lockedReleases.length) {
    console.warn('Close the old app or wait for Windows to release it, then delete the listed previous release folder.')
  }
}

try {
  run()
} catch (error) {
  console.error(`Release failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
