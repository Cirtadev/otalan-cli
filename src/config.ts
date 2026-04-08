import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { z } from 'zod'

export type Target = 'capacitor' | 'expo'
export type MobilePlatform = 'ios' | 'android'

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

const globalConfigSchema = z.object({
  apiKey: z.string().min(1),
  apiUrl: z.url().default('https://api.otalan.com'),
})

const projectConfigSchema = z.object({
  organizationSlug: z.string().min(1).optional(),
  projectSlug: z.string().min(1).optional(),
  appId: z.string().min(1),
})

export type GlobalConfig = z.infer<typeof globalConfigSchema>
export type ProjectConfig = z.infer<typeof projectConfigSchema>

// -----------------------------------------------------------------------------
// Paths
// -----------------------------------------------------------------------------

export const PROJECT_CONFIG_FILE = 'otalan.config.json'

function getGlobalConfigPath() {
  return path.join(os.homedir(), '.otalan', 'config.json')
}

// -----------------------------------------------------------------------------
// JSON helpers
// -----------------------------------------------------------------------------

async function readJsonFile<T>(filePath: string, schema: z.ZodType<T>) {
  const raw = await Bun.file(filePath).text()
  return schema.parse(JSON.parse(raw))
}

async function writeJsonFile(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await Bun.write(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

// -----------------------------------------------------------------------------
// Public helpers
// -----------------------------------------------------------------------------

export async function loadGlobalConfig() {
  return readJsonFile(getGlobalConfigPath(), globalConfigSchema)
}

export async function saveGlobalConfig(config: GlobalConfig) {
  await writeJsonFile(getGlobalConfigPath(), globalConfigSchema.parse(config))
}

export async function loadProjectConfig(cwd: string) {
  return readJsonFile(path.join(cwd, PROJECT_CONFIG_FILE), projectConfigSchema)
}

export async function saveProjectConfig(cwd: string, config: ProjectConfig) {
  const parsed = projectConfigSchema.parse(config)
  await writeJsonFile(path.join(cwd, PROJECT_CONFIG_FILE), {
    organizationSlug: parsed.organizationSlug,
    projectSlug: parsed.projectSlug,
    appId: parsed.appId,
  })
}
