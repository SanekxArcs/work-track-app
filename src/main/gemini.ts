import type { AiDaySummary, AiTaskSuggestion, AppSnapshot, GeminiModel, VoiceInput, VoiceTaskDraft } from '../shared/types'
import { WorkBuddyDatabase } from './database'

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  error?: { message?: string }
}

function responseText(payload: GeminiResponse): string {
  return payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim() ?? ''
}

function parseJson<T>(text: string): T {
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  return JSON.parse(clean) as T
}

function taskMinutes(snapshot: AppSnapshot, now = Date.now()): Array<{ description: string; project: string; minutes: number }> {
  return snapshot.tasks.map((task) => ({
    description: task.notes || task.title || 'No description',
    project: snapshot.projects.find((project) => project.id === task.projectId)?.name ?? '',
    minutes: Math.max(0, Math.round(task.intervals.reduce((sum, interval) => sum + ((interval.endedAt ?? now) - interval.startedAt), 0) / 60_000))
  })).filter((task) => task.minutes > 0)
}

export class GeminiService {
  constructor(
    private readonly database: WorkBuddyDatabase,
    private readonly readApiKey: () => string
  ) {}

  private async generate(model: GeminiModel, prompt: string, json = false, voice?: VoiceInput): Promise<string> {
    const apiKey = this.readApiKey()
    if (!apiKey) throw new Error('Gemini API key is missing')
    if (voice && (!voice.data || voice.data.length > 12 * 1024 * 1024)) throw new Error('Voice note is missing or too large')

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }, ...(voice ? [{ inlineData: { mimeType: voice.mimeType, data: voice.data } }] : [])] }],
        generationConfig: {
          temperature: 0.25,
          maxOutputTokens: 900,
          ...(json ? { responseMimeType: 'application/json' } : {})
        }
      })
    })
    const payload = await response.json() as GeminiResponse
    if (!response.ok) throw new Error(payload.error?.message || `Gemini request failed (${response.status})`)
    const text = responseText(payload)
    if (!text) throw new Error('Gemini returned an empty response')
    return text
  }

  async suggestTask(taskId: string): Promise<AiTaskSuggestion> {
    const snapshot = this.database.getSnapshot()
    const task = snapshot.tasks.find((item) => item.id === taskId)
    if (!task) throw new Error('Task not found')
    const locale = snapshot.settings.locale
    const projects = snapshot.projects.filter((project) => !project.archived).map((project) => project.name)
    const history = taskMinutes(snapshot).slice(0, 20)
    const prompt = `You are a concise assistant inside a personal time tracker. Reply only as JSON.
Language for the description: ${locale === 'uk' ? 'Ukrainian' : 'English'}.
Current task: ${JSON.stringify({ project: snapshot.projects.find((project) => project.id === task.projectId)?.name ?? '', description: task.notes })}
Known project names: ${JSON.stringify(projects)}
Recent work context: ${JSON.stringify(history)}
Improve the task description without inventing facts. Suggest one existing project name or null. Keep the description short and useful.
JSON schema: {"projectName":"string|null","description":"string"}`
    const raw = await this.generate(snapshot.settings.ai.model, prompt, true)
    const result = parseJson<{ projectName?: string | null; description?: string }>(raw)
    const matchedProject = result.projectName
      ? snapshot.projects.find((project) => project.name.localeCompare(result.projectName!, undefined, { sensitivity: 'base' }) === 0)
      : undefined
    return {
      projectId: matchedProject?.id ?? task.projectId,
      notes: result.description?.trim() || task.notes
    }
  }

  async summarizeDay(): Promise<AiDaySummary> {
    const snapshot = this.database.getSnapshot()
    const work = taskMinutes(snapshot)
    if (!work.length) throw new Error('There is no tracked work to summarize yet')
    const language = snapshot.settings.locale === 'uk' ? 'Ukrainian' : 'English'
    const prompt = `You are a friendly workday sidekick. Write in ${language}. Based only on this time-tracking data, write a compact 3-part recap: what received attention, where context switching or parallel work appeared, and one gentle actionable suggestion for tomorrow. No moralizing and no invented facts. Use 3 short bullet lines.
Data: ${JSON.stringify(work)}`
    return { summary: await this.generate(snapshot.settings.ai.model, prompt) }
  }

  async transcribeVoice(voice: VoiceInput): Promise<string> {
    const snapshot = this.database.getSnapshot()
    const language = snapshot.settings.locale === 'uk' ? 'Ukrainian' : 'English'
    const prompt = `Transcribe this short voice note faithfully in ${language} when that is the spoken language. Return only the transcription, with no quotes, labels, summary, or commentary.`
    return this.generate(snapshot.settings.ai.model, prompt, false, voice)
  }

  async interpretVoiceTask(voice: VoiceInput, taskId?: string): Promise<VoiceTaskDraft> {
    const snapshot = this.database.getSnapshot()
    const task = taskId ? snapshot.tasks.find((item) => item.id === taskId) : undefined
    const language = snapshot.settings.locale === 'uk' ? 'Ukrainian' : 'English'
    const projects = snapshot.projects.filter((project) => !project.archived).map((project) => project.name)
    const current = task ? {
      project: snapshot.projects.find((project) => project.id === task.projectId)?.name ?? '',
      notes: task.notes
    } : { project: '', notes: '' }
    const prompt = `You are the voice-command parser for a personal time tracker. Listen to the short voice note and reply only as JSON.
The user interface language is ${language}. Current task fields: ${JSON.stringify(current)}.
Known project names: ${JSON.stringify(projects)}.
Interpret only details actually spoken. The tracker has no task name or tags. For a field the user did not specify, return null. startTime and endTime must be HH:MM in 24-hour format or null. Do not infer planned tasks.
For projectName: return the exact known project name when it clearly matches one. If the user explicitly names a new project, return that name. Otherwise return null.
JSON schema: {"transcript":"string","projectName":"string|null","notes":"string|null","startTime":"HH:MM|null","endTime":"HH:MM|null"}`
    const raw = await this.generate(snapshot.settings.ai.model, prompt, true, voice)
    const result = parseJson<{ transcript?: string; projectName?: string | null; notes?: string | null; startTime?: string | null; endTime?: string | null }>(raw)
    const projectName = result.projectName?.trim() || null
    const matched = projectName ? snapshot.projects.find((project) => project.name.localeCompare(projectName, undefined, { sensitivity: 'base' }) === 0) : undefined
    const validTime = (value: string | null | undefined): string | null => value && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null
    return {
      transcript: result.transcript?.trim() || '',
      projectId: matched?.id ?? null,
      newProjectName: projectName && !matched ? projectName : null,
      notes: result.notes?.trim() || null,
      startTime: validTime(result.startTime),
      endTime: validTime(result.endTime)
    }
  }
}
