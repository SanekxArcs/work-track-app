import type { NotificationSound } from '../../shared/types'

type Tone = { frequency: number; at: number; duration: number; volume: number; wave?: OscillatorType }

const tones: Record<Exclude<NotificationSound, 'system' | 'custom'>, Tone[]> = {
  soft: [
    { frequency: 523.25, at: 0, duration: .22, volume: .055 },
    { frequency: 659.25, at: .14, duration: .26, volume: .05 },
    { frequency: 783.99, at: .3, duration: .34, volume: .045 }
  ],
  bell: [
    { frequency: 783.99, at: 0, duration: .42, volume: .06, wave: 'sine' },
    { frequency: 1174.66, at: .13, duration: .48, volume: .038, wave: 'sine' }
  ],
  pop: [
    { frequency: 440, at: 0, duration: .12, volume: .055, wave: 'triangle' },
    { frequency: 659.25, at: .11, duration: .16, volume: .05, wave: 'triangle' }
  ]
}

function normalizeVolume(volume: number): number {
  return Math.min(1, Math.max(0, volume))
}

function playTones(sequence: Tone[], volume: number): void {
  const context = new AudioContext()
  if (context.state === 'suspended') void context.resume()
  const master = context.createGain()
  master.gain.value = normalizeVolume(volume)
  master.connect(context.destination)
  const start = context.currentTime + .025
  for (const tone of sequence) {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const begins = start + tone.at
    const ends = begins + tone.duration
    oscillator.type = tone.wave ?? 'sine'
    oscillator.frequency.setValueAtTime(tone.frequency, begins)
    gain.gain.setValueAtTime(.0001, begins)
    gain.gain.exponentialRampToValueAtTime(tone.volume, begins + .025)
    gain.gain.exponentialRampToValueAtTime(.0001, ends)
    oscillator.connect(gain)
    gain.connect(master)
    oscillator.start(begins)
    oscillator.stop(ends + .02)
  }
  window.setTimeout(() => void context.close(), 1200)
}

export async function playNotificationSound(sound: NotificationSound, customDataUrl?: string, volume = 0.72): Promise<void> {
  if (sound === 'system') return
  if (sound === 'custom') {
    const dataUrl = customDataUrl || await window.workBuddy.getCustomSoundData()
    if (!dataUrl) return
    const audio = new Audio(dataUrl)
    audio.volume = normalizeVolume(volume)
    await audio.play()
    return
  }
  playTones(tones[sound], volume)
}
