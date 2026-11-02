/// <reference types="vite/client" />
import type { NitroScribeApi } from '@shared/api'

declare global {
  interface Window {
    api: NitroScribeApi
  }
}

declare module '*?raw' {
  const content: string
  export default content
}

export {}
