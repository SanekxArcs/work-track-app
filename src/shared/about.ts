/** Public links shown on the About card; the main process only opens https links to these hosts. */
export const ABOUT_LINKS = {
  repository: 'https://github.com/SanekxArcs/work-track-app',
  issues: 'https://github.com/SanekxArcs/work-track-app/issues',
  author: 'https://github.com/SanekxArcs',
  support: 'https://tunerfest.app/support'
} as const

export const EXTERNAL_LINK_HOSTS: ReadonlySet<string> = new Set(Object.values(ABOUT_LINKS).map((url) => new URL(url).hostname))
