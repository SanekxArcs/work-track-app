import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'

// One persistent helper avoids spawning PowerShell for every observation. It reads window
// metadata only; no keyboard hooks, screenshots, page content, or elevated access.
export const WINDOWS_ACTIVITY_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class WorkBuddyForeground {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint id);
}
"@
$parentProcess = [System.Diagnostics.Process]::GetProcessById(__PARENT_PID__)
while (-not $parentProcess.HasExited) {
 $handle = [WorkBuddyForeground]::GetForegroundWindow()
 $processIdValue = [uint32]0
 $null = [WorkBuddyForeground]::GetWindowThreadProcessId($handle, [ref]$processIdValue)
 $titleValue = New-Object System.Text.StringBuilder 512
 $null = [WorkBuddyForeground]::GetWindowText($handle, $titleValue, 512)
 $processNameValue = ''
 try { $processNameValue = [System.Diagnostics.Process]::GetProcessById($processIdValue).ProcessName + '.exe' } catch {}
 @{ app=$processNameValue; title=$titleValue.ToString(); at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress
 Start-Sleep -Milliseconds 2000
}
`
export interface ForegroundSample {
  app: string
  title: string
  at: number
}
export class WindowsActivityCollector {
  private child?: ChildProcess
  private retry?: ReturnType<typeof setTimeout>
  private stopped = true
  constructor(
    private sample: (value: ForegroundSample) => void,
    private error: (message: string | null) => void
  ) {}
  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.launch()
  }
  private launch(): void {
    if (this.stopped) return
    if (process.platform !== 'win32') {
      this.error('Windows activity capture is available on Windows only')
      return
    }
    const executable = join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    )
    const child = spawn(
      executable,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        Buffer.from(WINDOWS_ACTIVITY_SCRIPT.replace('__PARENT_PID__', String(process.pid)), 'utf16le').toString(
          'base64'
        )
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    this.child = child
    let buffer = '',
      diagnostic = ''
    child.stdout!.setEncoding('utf8')
    child.stdout!.on('data', (part: string) => {
      buffer += part
      if (buffer.length > 65536) {
        buffer = ''
        return
      }
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        try {
          const value = JSON.parse(line) as ForegroundSample
          if (typeof value.app === 'string' && typeof value.title === 'string' && Number.isFinite(value.at)) {
            this.error(null)
            this.sample(value)
          }
        } catch {
          /* Ignore PowerShell startup noise; never forward raw diagnostics containing titles. */
        }
      }
    })
    child.stderr!.on('data', (part: Buffer) => {
      diagnostic += part.toString()
      if (diagnostic.length > 1000) diagnostic = diagnostic.slice(-1000)
    })
    child.on('error', () => this.error('Windows activity helper could not start'))
    child.on('exit', () => {
      if (this.child === child) this.child = undefined
      if (!this.stopped) {
        this.error(
          diagnostic
            ? 'Windows activity helper stopped. Check Windows PowerShell availability.'
            : 'Windows activity helper disconnected; reconnecting…'
        )
        this.retry = setTimeout(() => this.launch(), 10000)
      }
    })
  }
  stop(): void {
    this.stopped = true
    clearTimeout(this.retry)
    this.child?.kill()
    this.child = undefined
  }
}
