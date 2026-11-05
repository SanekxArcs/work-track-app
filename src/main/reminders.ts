import { Notification, powerMonitor } from 'electron'
import type { AppSettings, IdlePeriod, Locale, NotificationSound, WellnessAction } from '../shared/types'
import { breakStreakStartedAt, dueRestTypes, restRemaining } from '../shared/rest'
import { isScheduledWorkday, scheduledWorkdayClockEndAt, scheduledWorkdayEndAt } from '../shared/workday'
import type { WorkBuddyDatabase } from './database'
import { staleReminderKeys } from './reminder-schedule'

const MINUTE = 60_000
const CHECK_INTERVAL = 5_000
const REST_ALARM_INTERVAL = 8_000

const copy = {
  uk: {
    breakTitle: 'Гей, видихни трохи 👋',
    breakBody: (minutes: number) => `Ти гарно попрацював. Відлипни від екрана хоча б на ${minutes} хв.`,
    pomodoroBody: (minutes: number) => `Фокус-відрізок закінчився. Перерва на ${minutes} хв уже йде, задачі на паузі.`,
    lunchTitle: 'Друже, час поїсти 🍜',
    lunchBody: (minutes: number) => `Серйозно, задачі нікуди не втечуть. Забирай свої ${minutes} хвилин на обід.`,
    wellness: (action: string) => `Ідеальний момент: ${action.toLocaleLowerCase('uk-UA')}.`,
    startTitle: 'Ну що, починаємо? ✨',
    startBody: 'Я тут і готовий рахувати. Запускай першу задачу.',
    endTitle: 'На сьогодні досить, чемпіоне',
    endBody: 'Збережи прогрес, зупини таймери й іди жити життя.',
    endLaterTitle: 'Звичний час завершення вже настав',
    endLaterBody: (minutes: number) => `Ти почав день пізніше, тож лишилося ще ${minutes} хв. Фініш рахуємо від твого фактичного старту.`,
    plannedTaskTitle: 'Час для запланованої задачі ⏰',
    plannedTaskBody: (title: string, notes: string) => notes ? `${title} — ${notes}` : title,
    idleTitle: 'Ти кудись відійшов?',
    idleBody: (minutes: number) => `Не бачу активності вже ${minutes} хв. Коли повернешся, запитаю, що робити з цим часом.`,
    idleReturnTitle: 'З поверненням 👋',
    idleReturnBody: (minutes: number) => `Тебе не було ${minutes} хв. У Work Buddy можна залишити цей час, викинути або зробити з нього перерву.`,
    restDoneTitle: 'Таймер відпочинку закінчився ⏰',
    restDoneBody: 'Як ти? Завершуй перерву — я поверну твої задачі в роботу.',
  },
  en: {
    breakTitle: 'Hey, take a breather 👋',
    breakBody: (minutes: number) => `Nice work. Step away from the screen for at least ${minutes} minutes.`,
    pomodoroBody: (minutes: number) => `The focus stretch is over. A ${minutes}-minute break is already running and your tasks are paused.`,
    lunchTitle: 'Buddy, food time 🍜',
    lunchBody: (minutes: number) => `Seriously, the tasks can wait. Take your ${minutes}-minute lunch.`,
    wellness: (action: string) => `Perfect moment to: ${action.toLocaleLowerCase('en-US')}.`,
    startTitle: 'Ready to roll? ✨',
    startBody: "I'm here and ready to count. Start your first task.",
    endTitle: "That's plenty for today, champ",
    endBody: 'Save your progress, stop the timers, and go enjoy real life.',
    endLaterTitle: 'Your usual finish time is here',
    endLaterBody: (minutes: number) => `You started later today, so you have ${minutes} min left. Your finish is based on your actual start.`,
    plannedTaskTitle: 'Time for your planned task ⏰',
    plannedTaskBody: (title: string, notes: string) => notes ? `${title} — ${notes}` : title,
    idleTitle: 'Did you step away?',
    idleBody: (minutes: number) => `No activity for ${minutes} minutes. When you are back I will ask what to do with that time.`,
    idleReturnTitle: 'Welcome back 👋',
    idleReturnBody: (minutes: number) => `You were away for ${minutes} min. In Work Buddy you can keep that time, discard it or turn it into a break.`,
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

function enabledWellness(settings: AppSettings, now: number): WellnessAction | undefined {
  const actions = settings.wellnessActions.filter((item) => item.enabled)
  if (!settings.wellnessEnabled || !actions.length) return undefined
  const index = new Date(now).getDate() % actions.length
  return actions[index]
}

export interface ReminderHooks {
  /** The user is back after an idle stretch (or the PC woke up) that overlapped a running task. */
  onIdleReturn?: (period: IdlePeriod) => void
  /** The reminders changed tracked data by themselves (a Pomodoro break started). */
  onDataChanged?: () => void
}

export class ReminderService {
  private timer: NodeJS.Timeout | null = null
  private fired = new Set<string>()
  private firedDate = ''
  private restAlarm: { restId: string; nextAt: number } | null = null
  private idleBucket = 0
  /** When the current idle stretch began, once it passed the threshold with a task running. */
  private idleSince: number | null = null
  private suspendedAt: number | null = null
  private readonly onSuspend = (): void => { this.suspendedAt = Date.now() }
  private readonly onResume = (): void => this.handleResume()

  constructor(
    private readonly database: WorkBuddyDatabase,
    private readonly onSound?: (sound: NotificationSound, volume: number) => void,
    private readonly hooks: ReminderHooks = {}
  ) {}

  start(): void {
    if (this.timer) return
    this.seedStale()
    this.check()
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL)
    powerMonitor.on('suspend', this.onSuspend)
    powerMonitor.on('resume', this.onResume)
  }

  /** Reminders scheduled long before launch are treated as already shown. */
  private seedStale(): void {
    try {
      const snapshot = this.database.getSnapshot()
      this.firedDate = todayKey(snapshot.now)
      for (const key of staleReminderKeys(snapshot, snapshot.now)) this.fired.add(key)
    } catch (error) {
      console.error('Reminder seeding failed', error)
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    powerMonitor.off('suspend', this.onSuspend)
    powerMonitor.off('resume', this.onResume)
  }

  /** Sleep counts as absence: a task left running overnight should not swallow the night. */
  private handleResume(): void {
    const startedAt = this.suspendedAt
    this.suspendedAt = null
    if (startedAt === null) return
    const endedAt = Date.now()
    if (endedAt - startedAt < MINUTE) return
    try {
      const snapshot = this.database.getSnapshot()
      const wasTracking = snapshot.tasks.some((task) => task.intervals.some((interval) => interval.startedAt < startedAt && (interval.endedAt ?? endedAt) > startedAt))
      if (!wasTracking) return
      this.idleSince = null
      this.idleBucket = 0
      this.hooks.onIdleReturn?.({ startedAt, endedAt })
      const text = copy[snapshot.settings.locale]
      this.show(text.idleReturnTitle, text.idleReturnBody(Math.round((endedAt - startedAt) / MINUTE)))
    } catch (error) {
      console.error('Resume handling failed', error)
    }
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
    // Runs on a timer: a failing read must not become an uncaught exception every tick.
    try {
      this.checkReminders()
    } catch (error) {
      console.error('Reminder check failed', error)
    }
  }

  private checkReminders(): void {
    const snapshot = this.database.getSnapshot()
    const now = snapshot.now
    const settings = snapshot.settings
    const locale: Locale = settings.locale
    const text = copy[locale]
    const nowMinute = currentMinute(now)
    const activeTasks = snapshot.tasks.filter((task) => task.status === 'running')
    const workday = snapshot.workday
    const openWorkday = workday?.endedAt === null

    // Any workday today, even an ended one, means the day has already started. Days off stay quiet.
    if (!workday && settings.workday.startReminder && isScheduledWorkday(settings, now) && nowMinute >= minuteOfDay(settings.workday.startTime)) {
      this.once(now, 'start', () => this.show(text.startTitle, text.startBody))
    }
    const scheduledEndAt = scheduledWorkdayEndAt(settings, snapshot.workday, snapshot.rests, now)
    const usualClockEndAt = scheduledWorkdayClockEndAt(settings, snapshot.workday)
    if (openWorkday && settings.workday.endReminder && scheduledEndAt !== null && usualClockEndAt !== null && scheduledEndAt > usualClockEndAt && now >= usualClockEndAt && now < scheduledEndAt) {
      const remainingMinutes = Math.max(1, Math.ceil((scheduledEndAt - now) / MINUTE))
      this.once(now, `end-later:${workday.id}`, () => this.show(text.endLaterTitle, text.endLaterBody(remainingMinutes)))
    }
    if (openWorkday && settings.workday.endReminder && scheduledEndAt !== null && now >= scheduledEndAt) {
      this.once(now, `end:${workday.id}`, () => this.show(text.endTitle, text.endBody))
    }
    for (const task of snapshot.plannedTasks) {
      if (task.reminderTime && nowMinute >= minuteOfDay(task.reminderTime)) {
        this.once(now, `planned-task:${task.id}`, () => this.show(text.plannedTaskTitle, text.plannedTaskBody(task.title, task.notes)))
      }
    }
    const due = dueRestTypes(settings, snapshot.workday, snapshot.rests, snapshot.tasks, now)
    if (due.includes('break')) {
      const streakStart = snapshot.workday ? breakStreakStartedAt(snapshot.workday, snapshot.rests) : now
      // In Pomodoro mode the break starts on its own; the notification then says so instead of asking.
      const autoBreak = settings.pomodoro.enabled && settings.pomodoro.autoStartBreak && activeTasks.length > 0
      this.once(now, `break-due:${streakStart}`, () => {
        const wellness = enabledWellness(settings, now)
        const extra = wellness ? ` ${text.wellness(locale === 'uk' ? wellness.labelUk : wellness.labelEn)}` : ''
        let started = false
        if (autoBreak) {
          try {
            this.database.startRest('break')
            started = true
            this.hooks.onDataChanged?.()
          } catch (error) {
            console.error('Pomodoro break could not start', error)
          }
        }
        this.show(text.breakTitle, `${started ? text.pomodoroBody(settings.breaks.durationMinutes) : text.breakBody(settings.breaks.durationMinutes)}${extra}`)
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
    this.checkIdle(settings, activeTasks.length > 0, now, text)
  }

  /**
   * Nudges during a long absence, then, once input returns, hands the whole stretch to the window
   * so the user can keep it, cut it out of the running tasks or turn it into a break.
   */
  private checkIdle(settings: AppSettings, tracking: boolean, now: number, text: (typeof copy)[Locale]): void {
    const idleMs = powerMonitor.getSystemIdleTime() * 1000
    const thresholdMs = settings.idle.thresholdMinutes * MINUTE
    if (this.idleSince !== null && idleMs < thresholdMs) {
      const period = { startedAt: this.idleSince, endedAt: Math.max(this.idleSince + MINUTE, now - idleMs) }
      this.idleSince = null
      this.idleBucket = 0
      this.hooks.onIdleReturn?.(period)
      return
    }
    if (!tracking || !settings.idle.enabled) {
      this.idleSince = null
      this.idleBucket = 0
      return
    }
    if (idleMs >= thresholdMs && this.idleSince === null) this.idleSince = now - idleMs
    // Buckets restart with every idle period, so each absence gets its own reminders.
    const bucket = Math.floor(idleMs / thresholdMs)
    if (bucket > this.idleBucket) this.show(text.idleTitle, text.idleBody(Math.floor(idleMs / MINUTE)))
    this.idleBucket = bucket
  }
}
