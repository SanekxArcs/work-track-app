import type { MessageKey, Translator } from './i18n'

/** Main-process validation messages, translated for the Ukrainian interface. */
const ukErrors: Record<string, string> = {
  'A project with this name already exists': 'Проєкт з такою назвою вже існує',
  'Active break not found': 'Активну перерву не знайдено',
  'Another break is already active': 'Інша перерва вже триває',
  'Audio file must be smaller than 15 MB': 'Аудіофайл має бути меншим за 15 МБ',
  'Budget must be at least one minute': 'Бюджет має бути щонайменше 1 хвилина',
  'Choose a backup file first': 'Спершу виберіть файл бекапу',
  'Choose a different project to merge into': 'Виберіть інший проєкт для об’єднання',
  'Choose a range of up to one year': 'Виберіть період не довший за рік',
  'Choose at least two tasks to merge': 'Виберіть щонайменше дві задачі для об’єднання',
  'Deadline must be a valid date': 'Дедлайн має бути коректною датою',
  'End time cannot be before the interval start': 'Завершення не може бути раніше за початок',
  'End time cannot be in the future': 'Завершення не може бути в майбутньому',
  'End time must stay on the same day': 'Завершення має бути в той самий день',
  'Every merged task must have time on the selected day': 'Кожна задача для об’єднання має мати час у вибраний день',
  'Finish the active break before merging a backup with an active break': 'Завершіть поточну перерву перед злиттям бекапу з активною перервою',
  'Finish the active break first': 'Спершу завершіть поточну перерву',
  'Finish the active workday before merging a backup with an active workday': 'Завершіть поточний день перед злиттям бекапу з активним днем',
  'Finish the workday before merging tasks': 'Завершіть робочий день перед об’єднанням задач',
  'Gemini API key is missing': 'Не додано ключ Gemini API',
  'Gemini returned an empty response': 'Gemini повернув порожню відповідь',
  'Invalid end time': 'Некоректний час завершення',
  'Invalid start time': 'Некоректний час початку',
  'One of the selected tasks was not found': 'Одну з вибраних задач не знайдено',
  'Pause the active break before starting a task': 'Призупиніть перерву, перш ніж запускати задачу',
  'Paused break not found': 'Призупинену перерву не знайдено',
  'Planned task name is required': 'Вкажіть назву запланованої задачі',
  'Planned task not found': 'Заплановану задачу не знайдено',
  'Project name is required': 'Вкажіть назву проєкту',
  'Project not found': 'Проєкт не знайдено',
  'Reminder time must be in HH:MM format': 'Час нагадування має бути у форматі ГГ:ХХ',
  'Rest start cannot overlap another break': 'Початок перерви не може накладатися на іншу перерву',
  'Rest start conflicts with tracked task time': 'Початок перерви накладається на час задач',
  'Rest start was not found': 'Початок перерви не знайдено',
  'Secure storage is not available on this device': 'Захищене сховище недоступне на цьому пристрої',
  'Start the workday first': 'Спершу почніть робочий день',
  'Start time cannot be after the interval end': 'Початок не може бути пізніше за завершення',
  'Start time must stay on the same day': 'Початок має бути в той самий день',
  'Task end was not found': 'Завершення задачі не знайдено',
  'Task interval not found': 'Відрізок задачі не знайдено',
  'Task intervals cannot overlap': 'Відрізки задачі не можуть накладатися',
  'Task not found': 'Задачу не знайдено',
  'Task start was not found': 'Початок задачі не знайдено',
  'Tasks with overlapping time cannot be merged': 'Задачі з часом, що накладається, не можна об’єднати',
  'The end date must not be before the start date': 'Кінцева дата не може бути раніше за початкову',
  'The selected file is not valid JSON': 'Вибраний файл не є коректним JSON',
  'The selected global shortcut is unavailable.': 'Це глобальне поєднання клавіш недоступне.',
  'There is no finished workday from today to continue': 'Сьогодні немає завершеного дня, який можна продовжити',
  'There is no tracked work to export for this period': 'За цей період немає записаного часу для експорту',
  'There is no tracked work to summarize yet': 'Поки немає записаного часу для підсумку',
  'This day has no overtime to redeem': 'У цей день немає переробки, яку можна списати',
  'This planned task is already completed': 'Ця запланована задача вже виконана',
  'This workday is no longer active': 'Цей робочий день уже не активний',
  'Unsupported audio format': 'Непідтримуваний формат аудіо',
  'Voice note is missing or too large': 'Голосова нотатка відсутня або завелика',
  'Workday start cannot be after tracked time': 'Початок дня не може бути пізніше за записаний час',
  'Workday start cannot be before the previous workday ended': 'Початок дня не може бути раніше, ніж завершився попередній робочий день',
  'Workday not found': 'Робочий день не знайдено',
  'Only today’s workday can be reset': 'Скинути можна лише сьогоднішній робочий день'
}

/**
 * Turns a rejected IPC call into text for the interface: drops Electron's
 * "Error invoking remote method" prefix and translates known validation messages.
 */
export function errorText(error: unknown, t: Translator, fallback: MessageKey): string {
  const raw = error instanceof Error ? error.message : ''
  const message = raw.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '').trim()
  if (!message) return t(fallback)
  if (t.locale !== 'uk') return message
  if (/^The selected (?:backup|file) /.test(message) && !ukErrors[message]) return t('backupError')
  return ukErrors[message] ?? message
}
