import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { safeStorage, shell } from 'electron'
import type { AppSnapshot, GoogleSyncResult } from '../shared/types'
import { WorkBuddyDatabase } from './database'

const AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CALENDAR_API_URL = 'https://www.googleapis.com/calendar/v3'
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created'
const TOKEN_SECRET = 'google_calendar_tokens'

type GoogleTokens = {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

type CalendarConnection = GoogleTokens & {
  calendarId: string
  calendarName: string
}

type TokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

function base64Url(value: Buffer): string {
  return value.toString('base64url')
}

function readError(body: unknown): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = (body as { error?: { message?: string } | string }).error
    if (typeof error === 'string') return error
    if (error?.message) return error.message
  }
  return 'Google Calendar request failed'
}

function eventId(intervalId: string): string {
  return `ab${intervalId.replaceAll('-', '')}`
}

export class GoogleCalendarService {
  constructor(private readonly database: WorkBuddyDatabase) {}

  private encrypt(connection: CalendarConnection): string {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this device')
    return safeStorage.encryptString(JSON.stringify(connection)).toString('base64')
  }

  private saveConnection(connection: CalendarConnection): void {
    this.database.setSecret(TOKEN_SECRET, this.encrypt(connection))
  }

  private getConnection(): CalendarConnection {
    const encrypted = this.database.getSecret(TOKEN_SECRET)
    if (!encrypted) throw new Error('Connect Google Calendar first')
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this device')
    try {
      return JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64'))) as CalendarConnection
    } catch {
      throw new Error('Google Calendar connection could not be read. Please reconnect.')
    }
  }

  private async requestToken(parameters: URLSearchParams): Promise<TokenResponse> {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: parameters
    })
    const payload = await response.json() as TokenResponse
    if (!response.ok || !payload.access_token) throw new Error(payload.error_description || payload.error || 'Google sign-in failed')
    return payload
  }

  private async accessToken(clientId: string): Promise<CalendarConnection> {
    const connection = this.getConnection()
    if (connection.expiresAt > Date.now() + 60_000) return connection
    const refreshed = await this.requestToken(new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: connection.refreshToken
    }))
    const next = {
      ...connection,
      accessToken: refreshed.access_token as string,
      refreshToken: refreshed.refresh_token || connection.refreshToken,
      expiresAt: Date.now() + (refreshed.expires_in ?? 3600) * 1000
    }
    this.saveConnection(next)
    return next
  }

  private async call<T>(connection: CalendarConnection, path: string, init: RequestInit): Promise<{ data: T; status: number }> {
    const response = await fetch(`${CALENDAR_API_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${connection.accessToken}`,
        'Content-Type': 'application/json',
        ...init.headers
      }
    })
    const data = await response.json().catch(() => ({})) as T
    if (!response.ok) throw new Error(readError(data))
    return { data, status: response.status }
  }

  private async authorize(clientId: string): Promise<GoogleTokens> {
    const verifier = base64Url(randomBytes(64))
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const state = base64Url(randomBytes(24))
    const callback = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
      let settled = false
      let redirectUri = ''
      const server = createServer((request, response) => {
        const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
        if (requestUrl.pathname !== '/oauth2/callback') {
          response.writeHead(404).end()
          return
        }
        const receivedState = requestUrl.searchParams.get('state')
        const code = requestUrl.searchParams.get('code')
        const error = requestUrl.searchParams.get('error')
        const complete = (failure?: Error): void => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          server.close()
          if (failure) reject(failure)
          else resolve({ code: code as string, redirectUri })
        }
        if (error || receivedState !== state || !code) {
          response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          response.end('<main><h2>Google Calendar was not connected.</h2><p>You can close this tab and return to Work Buddy.</p></main>')
          complete(new Error(error === 'access_denied' ? 'Google Calendar permission was declined' : 'Google sign-in could not be verified'))
          return
        }
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end('<main><h2>Work Buddy is connected ✨</h2><p>You can close this tab and return to the app.</p></main>')
        complete()
      })
      const timeout = setTimeout(() => {
        if (settled) return
        settled = true
        server.close()
        reject(new Error('Google sign-in timed out. Please try again.'))
      }, 4 * 60_000)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') {
          clearTimeout(timeout)
          server.close()
          reject(new Error('Could not start the secure Google sign-in callback'))
          return
        }
        redirectUri = `http://127.0.0.1:${address.port}/oauth2/callback`
        const url = new URL(AUTHORIZATION_URL)
        url.search = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: GOOGLE_SCOPE,
          access_type: 'offline',
          prompt: 'consent',
          state,
          code_challenge: challenge,
          code_challenge_method: 'S256'
        }).toString()
        void shell.openExternal(url.toString()).catch((error: unknown) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          server.close()
          reject(error instanceof Error ? error : new Error('Could not open the browser'))
        })
      })
    })
    const token = await this.requestToken(new URLSearchParams({
      client_id: clientId,
      code: callback.code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: callback.redirectUri
    }))
    if (!token.refresh_token) throw new Error('Google did not return a refresh token. Please try connecting again.')
    return {
      accessToken: token.access_token as string,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000
    }
  }

  async connect(clientId: string): Promise<AppSnapshot> {
    const cleanClientId = clientId.trim()
    if (!cleanClientId) throw new Error('Paste a Google OAuth Desktop client ID first')
    const tokens = await this.authorize(cleanClientId)
    const calendar = await this.call<{ id: string; summary: string }>({ ...tokens, calendarId: '', calendarName: '' }, '/calendars', {
      method: 'POST',
      body: JSON.stringify({ summary: 'Work Buddy', description: 'Tracked work sessions created by Work Buddy.' })
    })
    if (!calendar.data.id) throw new Error('Google Calendar did not create the Work Buddy calendar')
    this.saveConnection({ ...tokens, calendarId: calendar.data.id, calendarName: calendar.data.summary || 'Work Buddy' })
    const settings = this.database.getSettings()
    return this.database.updateSettings({
      ...settings,
      googleCalendar: { ...settings.googleCalendar, clientId: cleanClientId, calendarId: calendar.data.id, calendarName: calendar.data.summary || 'Work Buddy', hasConnection: true }
    })
  }

  disconnect(): AppSnapshot {
    this.database.deleteSecret(TOKEN_SECRET)
    const settings = this.database.getSettings()
    return this.database.updateSettings({
      ...settings,
      googleCalendar: { ...settings.googleCalendar, calendarId: '', calendarName: '', hasConnection: false }
    })
  }

  async sync(days = 182): Promise<GoogleSyncResult> {
    const settings = this.database.getSettings()
    if (!settings.googleCalendar.clientId) throw new Error('Google OAuth client ID is missing')
    const connection = await this.accessToken(settings.googleCalendar.clientId)
    let created = 0
    let updated = 0
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    for (const interval of this.database.getGoogleCalendarEvents(days)) {
      const title = interval.title.trim() || 'Untitled task'
      const description = [
        interval.projectName && `Project: ${interval.projectName}`,
        interval.tags.length > 0 && `Tags: ${interval.tags.join(', ')}`,
        interval.notes.trim()
      ].filter(Boolean).join('\n')
      const body = {
        id: eventId(interval.id),
        summary: interval.projectName ? `${interval.projectName} · ${title}` : title,
        description,
        start: { dateTime: new Date(interval.startedAt).toISOString(), timeZone },
        end: { dateTime: new Date(interval.endedAt).toISOString(), timeZone },
        extendedProperties: { private: { workBuddyIntervalId: interval.id } }
      }
      const encodedCalendar = encodeURIComponent(connection.calendarId)
      const insert = await fetch(`${CALENDAR_API_URL}/calendars/${encodedCalendar}/events?sendUpdates=none`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${connection.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (insert.ok) {
        created += 1
        continue
      }
      if (insert.status !== 409) throw new Error(readError(await insert.json().catch(() => ({}))))
      const { id: _eventId, ...updateBody } = body
      await this.call(connection, `/calendars/${encodedCalendar}/events/${eventId(interval.id)}?sendUpdates=none`, { method: 'PATCH', body: JSON.stringify(updateBody) })
      updated += 1
    }
    return { created, updated, calendarName: connection.calendarName }
  }

  async openSetup(): Promise<void> {
    await shell.openExternal('https://console.cloud.google.com/apis/credentials')
  }
}
