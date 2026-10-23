import type { ActivityAssignment, ActivityRecord } from './activity'
import type { Project } from './types'
export interface ActivityRule {
  id?: string
  kind: 'app' | 'domain' | 'browserProject' | 'windowTitle'
  pattern: string
  projectId: string
  enabled?: boolean
  app?: string
  sourceId?: string
}
export interface ProjectCatalogEntry {
  id: string
  name: string
  color?: string
  archived: boolean
}
export interface BrowserProjectEntry extends ProjectCatalogEntry {
  sourceId: string
}
export interface ActivityProjectLink {
  browserSourceId: string
  browserProjectId: string
  projectId: string | null
  revision: number
}
export interface ActivityProjectRegistry {
  deviceId: string
  workProjects: ProjectCatalogEntry[]
  browserProjects: BrowserProjectEntry[]
  links: ActivityProjectLink[]
  updatedAt: number | null
  error?: string | null
}
export interface ProjectLinkChange {
  browserSourceId: string
  browserProjectId: string
  projectId: string | null
  expectedRevision: number
}
export type ActivityMatchKind =
  | 'correction'
  | 'link'
  | 'rule'
  | 'name'
  | 'unassigned'
  | 'conflict'
  | 'confirmed'
export function ruleMatches(
  rule: ActivityRule,
  record: ActivityRecord
): boolean {
  if (
    rule.enabled === false ||
    (rule.sourceId && rule.sourceId !== record.sourceId)
  )
    return false
  if (rule.kind === 'browserProject')
    return record.kind === 'browser' && record.browserProjectId === rule.pattern
  if (rule.kind === 'windowTitle')
    return (
      (!rule.app || record.app.toLowerCase() === rule.app.toLowerCase()) &&
      record.title.toLowerCase().includes(rule.pattern.toLowerCase())
    )
  if (rule.kind === 'domain')
    return (
      record.domain === rule.pattern ||
      Boolean(record.domain?.endsWith('.' + rule.pattern))
    )
  return (
    record.kind === 'desktop' &&
    record.app.toLowerCase() === rule.pattern.toLowerCase()
  )
}
export function resolveActivityProject(
  record: ActivityRecord,
  assignments: ActivityAssignment[],
  rules: ActivityRule[],
  projects: Project[],
  links: ActivityProjectLink[] = []
): { projectId: string | null; match: ActivityMatchKind } {
  const active = (id: string | null | undefined) =>
    id && projects.some((p) => p.id === id && !p.archived)
  const correction = assignments.find((a) => a.recordId === record.id)
  if (active(correction?.projectId))
    return { projectId: correction!.projectId, match: 'correction' }
  const link = links.find(
    (l) =>
      l.browserSourceId === record.sourceId &&
      l.browserProjectId === record.browserProjectId
  )
  if (active(link?.projectId))
    return { projectId: link!.projectId, match: 'link' }
  for (const kind of [
    'browserProject',
    'windowTitle',
    'domain',
    'app'
  ] as ActivityRule['kind'][]) {
    const candidates = rules.filter(
      (r) => r.kind === kind && active(r.projectId) && ruleMatches(r, record)
    )
    const ids = [...new Set(candidates.map((r) => r.projectId))]
    if (ids.length > 1) return { projectId: null, match: 'conflict' }
    if (ids.length === 1) return { projectId: ids[0], match: 'rule' }
  }
  const label = record.projectName?.trim().normalize('NFKC').toLocaleLowerCase()
  const matches = label
    ? projects.filter(
        (p) =>
          !p.archived &&
          p.name.trim().normalize('NFKC').toLocaleLowerCase() === label
      )
    : []
  return matches.length === 1
    ? { projectId: matches[0].id, match: 'name' }
    : { projectId: null, match: 'unassigned' }
}
export function normalizeActivityRule(raw: ActivityRule): ActivityRule {
  if (
    !raw ||
    !['app', 'domain', 'browserProject', 'windowTitle'].includes(raw.kind) ||
    typeof raw.pattern !== 'string' ||
    !raw.pattern.trim() ||
    raw.pattern.length > 500 ||
    typeof raw.projectId !== 'string' ||
    !raw.projectId ||
    (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') ||
    (raw.id !== undefined &&
      (typeof raw.id !== 'string' || raw.id.length > 160)) ||
    (raw.app !== undefined &&
      (typeof raw.app !== 'string' || raw.app.length > 200)) ||
    (raw.sourceId !== undefined &&
      (typeof raw.sourceId !== 'string' || raw.sourceId.length > 100))
  )
    throw new Error('Invalid project rule')
  let pattern = raw.pattern.trim()
  if (raw.kind === 'domain') {
    pattern = pattern.toLowerCase().replace(/^\*\./, '').replace(/\.$/, '')
    if (
      !/^(?:localhost|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)$/.test(pattern) ||
      pattern.includes('..')
    )
      throw new Error('Enter a domain without a path or protocol')
  }
  if (raw.kind === 'app') pattern = pattern.toLowerCase()
  return {
    id: raw.id,
    kind: raw.kind,
    pattern,
    projectId: raw.projectId,
    enabled: raw.enabled !== false,
    ...(raw.app?.trim() ? { app: raw.app.trim().toLowerCase() } : {}),
    ...(raw.sourceId ? { sourceId: raw.sourceId } : {})
  }
}

export interface ActivityLearningResponse {
  registry?: ActivityProjectRegistry
  preview?: {
    id: string
    input: import('./activity-matching').ActivityMatchingInput
  }
  matching?: import('./activity-matching').ActivityMatchingResult
  data?: import('./activity').ActivityDay
}
