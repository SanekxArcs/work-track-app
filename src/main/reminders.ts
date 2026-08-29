import { Notification, powerMonitor } from 'electron'
import type { AppSettings, Locale, NotificationSound, WellnessAction } from '../shared/types'
import { breakStreakStartedAt, dueRestTypes, restRemaining } from '../shared/rest'
import { scheduledWorkdayEndAt } from '../shared/workday'
import type { WorkBuddyDatabase } from './database'

const MINUTE = 60_000
const CHECK_INTERVAL = 5_000
const REST_ALARM_INTERVAL = 8_000

const copy = {
  uk: {
    breakTitle: 'Гей, видихни трохи 👋',
    breakBody: (minutes: number) => `Ти гарно попрацював. Відлипни від екрана хоча б на ${minutes} хв.`,
    lunchTitle: 'Друже, час поїсти 🍜',
    lunchBody: (minutes: number) => `Серйозно, задачі нікуди не втечуть. Забирай свої ${minutes} хвилин на обід.`,
    wellness: (action: string) => `Ідеальний момент: ${action.toLocaleLowerCase('uk-UA')}.`,
    startTitle: 'Ну що, починаємо? ✨',
    startBody: 'Я тут і готовий рахувати. Запускай першу задачу.',
    endTitle: 'На сьогодні досить, чемпіоне',
    endBody: 'Збережи прогрес, зупини таймери й іди жити життя.',
    idleTitle: 'Ти кудись відійшов?',
    idleBody: (minutes: number) => `Не бачу активності вже ${minutes} хв. Перевір, чи варто залишити цей час.`,
    restDoneTitle: 'Таймер відпочинку закінчився ⏰',
    restDoneBody: 'Як ти? Завершуй перерву — я поверну твої задачі в роботу.',
  },
  en: {
    breakTitle: 'Hey, take a breather 👋',
    breakBody: (minutes: number) => `Nice work. Step away from the screen for at least ${minutes} minutes.`,
    lunchTitle: 'Buddy, food time 🍜',
    lunchBody: (minutes: number) => `Seriously, the tasks can wait. Take your ${minutes}-minute lunch.`,
    wellness: (action: string) => `Perfect moment to: ${action.toLocaleLowerCase('en-US')}.`,
    startTitle: 'Ready to roll? ✨',
    startBody: "I'm here and ready to count. Start your first task.",
    endTitle: "That's plenty for today, champ",
    endBody: 'Save your progress, stop the timers, and go enjoy real life.',
    idleTitle: 'Did you step away?',
    idleBody: (minutes: number) => `No activity for ${minutes} minutes. Check whether you want to keep this time.`,
    restDoneTitle: 'Your rest timer is up ⏰',
    restDoneBody: "How are you feeling? Finish the break and I'll bring your tasks back.",
  }
}

function todayKey(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('sv-SE')
}

function minuteOfDay(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function currentMinute(timestamp: number): number {
  const now = new Date(timestamp)
  return now.getHours() * 60 + now.getMinutes()
}

function enabledWellness(settings: AppSettings): WellnessAction | undefined {
  const actions = settings.wellnessActions.filter((item) => item.enabled)
  if (!settings.wellnessEnabled || !actions.length) return undefined
  const index = new Date().getDate() % actions.length
  return actions[index]
}

export class ReminderService {
  private timer: NodeJS.Timeout | null = null
  private fired = new Set<string>()
  private firedDate = ''
  private restAlarm: { restId: string; nextAt: number } | null = null

  constructor(
    private readonly database: WorkBuddyDatabase,
    private readonly onSound?: (sound: NotificationSound, volume: number) => void
  ) {}

  start(): void {
    if (this.timer) return
    this.check()
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private show(title: string, body: string): void {
    const sound = this.database.getSettings().notifications.sound
    if (Notification.isSupported()) new Notification({ title, body, silent: sound !== 'system' }).show()
    if (sound !== 'system') this.onSound?.(sound, this.database.getSettings().notifications.volume)
  }

  private once(now: number, key: string, callback: () => void): void {
    const date = todayKey(now)
    if (this.firedDate !== date) {
      this.firedDate = date
      this.fired.clear()
    }
    if (this.fired.has(key)) return
    this.fired.add(key)
    callback()
  }

  private repeatRestAlarm(restId: string, settings: AppSettings, now: number): void {
    if (!this.restAlarm || this.restAlarm.restId !== restId) {
      this.restAlarm = { restId, nextAt: now + REST_ALARM_INTERVAL }
      return
    }
    if (now < this.restAlarm.nextAt) return
    this.onSound?.(settings.notifications.sound, settings.notifications.volume)
    this.restAlarm.nextAt = now + REST_ALARM_INTERVAL
  }

  private check(): void {
    const snapshot = this.database.getSnapshot()
    const now = snapshot.now
    const settings = snapshot.settings
    const locale: Locale = settings.locale
    const text = copy[locale]
    const nowMinute = currentMinute(now)
    const activeTasks = snapshot.tasks.filter((task) => task.status === 'running')
    const openWorkday = snapshot.workday && snapshot.workday.endedAt === null

    if (!openWorkday && settings.workday.startReminder && nowMinute >= minuteOfDay(settings.workday.startTime)) {
      this.once(now, 'start', () => this.show(text.startTitle, text.startBody))
    }
    const scheduledEndAt = scheduledWorkdayEndAt(settings, snapshot.workday, snapshot.rests, now)
    if (openWorkday && settings.workday.endReminder && scheduledEndAt !== null && now >= scheduledEndAt) {
      this.once(now, 'end', () => this.show(text.endTitle, text.endBody))
    }
    const due = dueRestTypes(settings, snapshot.workday, snapshot.rests, snapshot.tasks, now)
    if (due.includes('break')) {
      const streakStart = snapshot.workday ? breakStreakStartedAt(snapshot.workday, snapshot.rests) : now
      this.once(now, `break-due:${streakStart}`, () => {
        const wellness = enabledWellness(settings)
        const extra = wellness ? ` ${text.wellness(locale === 'uk' ? wellness.labelUk : wellness.labelEn)}` : ''
        this.show(text.breakTitle, `${text.breakBody(settings.breaks.durationMinutes)}${extra}`)
      })
    }
    if (due.includes('lunch')) {
      const reminderBucket = Math.floor(nowMinute / 20)
      this.once(now, `lunch-due:${reminderBucket}`, () => this.show(text.lunchTitle, text.lunchBody(settings.lunch.durationMinutes)))
    }
    const runningRest = snapshot.rests.find((rest) => rest.status === 'running')
    if (runningRest && restRemaining(runningRest, now) === 0 && !runningRest.alarmMuted) {
      this.once(now, `rest-done:${runningRest.id}`, () => this.show(text.restDoneTitle, text.restDoneBody))
      this.repeatRestAlarm(runningRest.id, settings, now)
    } else this.restAlarm = null
    if (activeTasks.length && settings.idle.enabled) {
      const idleMinutes = Math.floor(powerMonitor.getSystemIdleTime() / 60)
      if (idleMinutes >= settings.idle.thresholdMinutes) {
        const bucket = Math.floor(idleMinutes / settings.idle.thresholdMinutes)
        this.once(now, `idle:${bucket}`, () => this.show(text.idleTitle, text.idleBody(idleMinutes)))
      }
    }
  }
}
