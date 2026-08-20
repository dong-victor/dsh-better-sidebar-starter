/**
 * Config store: CRUD for run configurations, persisted as JSON in the
 * session's working directory (`<cwd>/.dsh/run-configs.json`). All paths
 * are canonical (already passed through the session gate) — this service
 * trusts its caller for path safety.
 * @module dsh-better-sidebar-starter/host/configStore
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Supported configuration types. */
export type RunConfigType = 'npm' | 'springboot' | 'python' | 'custom'

/** One persisted run configuration. */
export interface RunConfig {
  id: string
  name: string
  type: RunConfigType
  command: string
  /** Relative to session cwd; defaults to '.'. */
  cwd: string
  env: Record<string, string>
  createdAt: number
  updatedAt: number
  lastRunAt: number | null
}

/** The on-disk file shape. */
interface ConfigFile {
  configs: RunConfig[]
  version: number
}

const FILE_VERSION = 1
const CONFIG_DIR = '.dsh'
const CONFIG_FILE = 'run-configs.json'

/** Resolve the config file path inside a canonical session cwd. */
function configFilePath(cwd: string): string {
  return join(cwd, CONFIG_DIR, CONFIG_FILE)
}

/** Read all configs from the session's working directory. */
export async function readConfigs(cwd: string): Promise<RunConfig[]> {
  const filePath = configFilePath(cwd)
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as ConfigFile
    if (!Array.isArray(parsed.configs)) return []
    return parsed.configs.filter((c): c is RunConfig =>
      typeof c === 'object' && c !== null
      && typeof c.id === 'string'
      && typeof c.name === 'string'
      && typeof c.type === 'string'
      && typeof c.command === 'string'
      && typeof c.cwd === 'string'
      && typeof c.env === 'object' && c.env !== null
      && typeof c.createdAt === 'number'
      && typeof c.updatedAt === 'number'
      && (c.lastRunAt === null || typeof c.lastRunAt === 'number'),
    )
  } catch {
    return []
  }
}

/** Write all configs to the session's working directory (atomic-ish: mkdir then write). */
async function writeConfigs(cwd: string, configs: RunConfig[]): Promise<void> {
  const filePath = configFilePath(cwd)
  await mkdir(dirname(filePath), { recursive: true })
  const payload: ConfigFile = { configs, version: FILE_VERSION }
  await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8')
}

/** Create a new config or update an existing one (matched by id). */
export async function upsertConfig(cwd: string, input: Partial<RunConfig> & { name: string }): Promise<RunConfig> {
  const configs = await readConfigs(cwd)
  const now = Date.now()

  if (input.id !== undefined) {
    const idx = configs.findIndex((c) => c.id === input.id)
    if (idx >= 0) {
      const existing = configs[idx]
      const updated: RunConfig = {
        ...existing,
        name: input.name,
        type: input.type ?? existing.type,
        command: input.command ?? existing.command,
        cwd: input.cwd ?? existing.cwd,
        env: input.env ?? existing.env,
        updatedAt: now,
      }
      configs[idx] = updated
      await writeConfigs(cwd, configs)
      return updated
    }
  }

  const config: RunConfig = {
    id: input.id ?? randomUUID(),
    name: input.name,
    type: input.type ?? 'custom',
    command: input.command ?? '',
    cwd: input.cwd ?? '.',
    env: input.env ?? {},
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
  }
  configs.push(config)
  await writeConfigs(cwd, configs)
  return config
}

/** Delete a config by id. Returns true if the config existed and was removed. */
export async function deleteConfig(cwd: string, id: string): Promise<boolean> {
  const configs = await readConfigs(cwd)
  const idx = configs.findIndex((c) => c.id === id)
  if (idx < 0) return false
  configs.splice(idx, 1)
  await writeConfigs(cwd, configs)
  return true
}

/** Stamp a config's lastRunAt (called when an instance starts). */
export async function stampLastRun(cwd: string, id: string): Promise<void> {
  const configs = await readConfigs(cwd)
  const idx = configs.findIndex((c) => c.id === id)
  if (idx < 0) return
  configs[idx].lastRunAt = Date.now()
  await writeConfigs(cwd, configs)
}
