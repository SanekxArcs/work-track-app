import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packagePath = resolve(root, 'package.json')
const lockfilePath = resolve(root, 'package-lock.json')
const extensionPackagePath = resolve(root, 'apps', 'extension', 'package.json')
const extensionLockfilePath = resolve(root, 'apps', 'extension', 'package-lock.json')
const releaseDirectoryPattern = /^release-v\d+\.\d+\.\d+$/

function usage() {
  console.log('Usage: npm run release:win [patch|minor|major|x.y.z]')
  console.log('Defaults to a patch release. Previous release-vX.Y.Z folders are removed after a successful build.')
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

function setLockfileVersion(path, version) {
  if (!existsSync(path)) return
  const lockfile = JSON.parse(readFileSync(path, 'utf8'))
  lockfile.version = version
  if (lockfile.packages?.['']) lockfile.packages[''].version = version
  writeJson(path, lockfile)
}

function npm(script, cwd) {
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npm'
  const commandArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', `npm run ${script}`]
    : ['run', script]
  return spawnSync(command, commandArgs, { cwd, stdio: 'inherit' })
}

/** Snapshots files so a failed release leaves the project exactly as it was. */
function snapshotFiles(paths) {
  const originals = paths.filter((path) => existsSync(path)).map((path) => [path, readFileSync(path)])
  return () => {
    for (const [path, content] of originals) writeFileSync(path, content)
    console.warn('Restored the original version files.')
  }
}

function removePreviousReleases(currentOutput) {
  const releaseDirectories = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && releaseDirectoryPattern.test(entry.name) && entry.name !== currentOutput)
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
  const restoreVersions = snapshotFiles([packagePath, lockfilePath, extensionPackagePath, extensionLockfilePath])

  let build
  try {
    packageJson.version = version
    packageJson.build ??= {}
    packageJson.build.directories ??= {}
    packageJson.build.directories.output = output
    writeJson(packagePath, packageJson)
    setLockfileVersion(lockfilePath, version)

    // The extension has its own version line; bump it alongside the app and
    // rebuild it so Chrome sees an update. An explicit x.y.z applies only to
    // the app; the extension then gets a patch bump.
    if (existsSync(extensionPackagePath)) {
      const extensionPackage = JSON.parse(readFileSync(extensionPackagePath, 'utf8'))
      const extensionVersion = nextVersion(extensionPackage.version, /^\d+\.\d+\.\d+$/.test(releaseType) ? 'patch' : releaseType)
      extensionPackage.version = extensionVersion
      writeJson(extensionPackagePath, extensionPackage)
      setLockfileVersion(extensionLockfilePath, extensionVersion)
      console.log(`Extension version: ${extensionVersion}`)
      build = npm('build', dirname(extensionPackagePath))
    }

    if (!build || (!build.error && build.status === 0)) build = npm('dist:win', root)
  } catch (error) {
    restoreVersions()
    throw error
  }
  if (build.error || build.status !== 0) {
    restoreVersions()
    if (build.error) throw build.error
    process.exit(build.status ?? 1)
  }

  // Only a finished build may replace the previous release folders.
  const lockedReleases = removePreviousReleases(output)

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
