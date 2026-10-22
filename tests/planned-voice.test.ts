import assert from 'node:assert/strict'
import test from 'node:test'
import { GeminiService } from '../src/main/gemini.ts'
import type { WorkBuddyDatabase } from '../src/main/database.ts'

const voice = { data: 'audio-fixture', mimeType: 'audio/webm' }

test('planned voice separates project, description and reminder without changing task-editing mode', async (t) => {
  const database = { getSnapshot: () => ({
    tasks: [], projects: [{ id: 'work', name: 'Work Buddy', archived: false }],
    settings: { locale: 'uk', ai: { model: 'gemini-3.5-flash-lite' } }
  }) } as unknown as WorkBuddyDatabase
  const service = new GeminiService(database, () => 'test-key')
  const prompts: string[] = []
  let response = { transcript: 'Work Buddy, виправити меню о п’ятнадцятій тридцять.', projectName: 'work buddy', notes: 'Виправити меню.', startTime: '15:30', endTime: null as string | null }
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    prompts.push(JSON.parse(options.body as string).contents[0].parts[0].text)
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(response) }] } }] }), { status: 200 })
  })
  const planned = await service.interpretVoiceTask(voice, undefined, true)
  assert.equal(planned.projectId, 'work')
  assert.equal(planned.notes, 'Виправити меню.')
  assert.equal(planned.startTime, '15:30')
  assert.equal(planned.newProjectName, null)
  assert.match(prompts[0], /PLANNED task/)
  assert.match(prompts[0], /duration.*not a clock time/)
  assert.match(prompts[0], /Never repeat the project/)

  response = { transcript: 'Новий проєкт Atlas, перевірити форми.', projectName: 'Atlas', notes: 'Перевірити форми.', startTime: '25:99', endTime: null }
  const newProject = await service.interpretVoiceTask(voice, undefined, true)
  assert.equal(newProject.newProjectName, 'Atlas')
  assert.equal(newProject.projectId, null)
  assert.equal(newProject.startTime, null)

  response = { transcript: 'Виправити меню, це займе дві години.', projectName: '', notes: 'Виправити меню, це займе дві години.', startTime: '', endTime: null }
  const untimed = await service.interpretVoiceTask(voice, undefined, true)
  assert.equal(untimed.projectId, null)
  assert.equal(untimed.startTime, null)
  assert.equal(untimed.notes, response.notes)
  await service.interpretVoiceTask(voice)
  assert.match(prompts.at(-1)!, /Do not infer planned tasks/)
  assert.doesNotMatch(prompts.at(-1)!, /PLANNED task/)

  response.transcript = ''
  await assert.rejects(service.interpretVoiceTask(voice, undefined, true), /no text/)
})
