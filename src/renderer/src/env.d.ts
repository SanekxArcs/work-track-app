/// <reference types="vite/client" />

import type { WorkBuddyApi } from '@shared/types'

declare global {
  interface Window {
    workBuddy: WorkBuddyApi
  }
}

export {}
