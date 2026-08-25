import type { SnapflowApi } from '../../preload/index'

declare global {
  interface Window {
    snapflow: SnapflowApi
  }
}

export {}
