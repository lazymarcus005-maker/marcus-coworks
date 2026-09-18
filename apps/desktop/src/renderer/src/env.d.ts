import type { StudioApi } from '@studio/shared'

declare global {
  interface Window {
    studio: StudioApi
  }
}
