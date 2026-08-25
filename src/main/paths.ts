import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

export type SnapFlowPaths = {
  root: string
  config: string
  screenshots: string
  thumbnails: string
  database: string
  logs: string
  cache: string
}

let cached: SnapFlowPaths | null = null

export function getSnapFlowPaths(): SnapFlowPaths {
  if (cached) return cached
  const root = app.getPath('userData')
  cached = {
    root,
    config: path.join(root, 'config'),
    screenshots: path.join(root, 'screenshots'),
    thumbnails: path.join(root, 'thumbnails'),
    database: path.join(root, 'database'),
    logs: path.join(root, 'logs'),
    cache: path.join(root, 'cache')
  }
  for (const dir of Object.values(cached)) fs.mkdirSync(dir, { recursive: true })
  return cached
}
