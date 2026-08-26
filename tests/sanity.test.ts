import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldRestoreCloudBackup } from '../src/main/sanity.ts'
import type { BackupData } from '../src/shared/types.ts'

function emptyBackup(): BackupData {
  return {
    schemaVersion: 1,
    exportedAt: Date.now(),
    settings: {
      locale: 'uk', theme: 'dark', alwaysOnTop: true, autoStart: true,
      workday: { startReminder: true, startTime: '09:00', endReminder: true, endTime: '18:00' },
      breaks: { enabled: true, everyMinutes: 55, durationMinutes: 5 },
      lunch: { enabled: true, mode: 'worked', time: '13:00', afterMinutes: 240, durationMinutes: 30, includedInWorkHours: false },
      idle: { enabled: true, thresholdMinutes: 10 },
      notifications: { sound: 'soft', volume: 0.7, customSoundPath: '', customSoundName: '' },
      wellnessEnabled: true, wellnessActions: [], projectColors: []
    },
    projects: [], plannedTasks: [], tasks: [], workdays: [], rests: [], overtimeRedeemedDates: []
  }
}

test('restores cloud history only into a genuinely fresh local workspace', () => {
  const backup = emptyBackup()
  assert.equal(shouldRestoreCloudBackup(backup), true)
  backup.projects.push({ id: 'project', name: 'Local project', color: '#ffffff', archived: false, createdAt: Date.now() })
  assert.equal(shouldRestoreCloudBackup(backup), false)
})
