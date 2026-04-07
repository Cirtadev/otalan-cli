import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { z } from 'zod'

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

const globalConfigSchema = z.object({
  apiKey: z.string().min(1),
  apiUrl: z.url().default('https://api.otalan.com'),
})

const projectConfigFileSchema = z.object({
  projectId: z.string().min(1).optional(),
  organizationSlug: z.string().min(1).optional(),
  projectSlug: z.string().min(1).optional(),
  appId: z.string().min(1),
  target: z.enum(['capacitor', 'expo']),
  channel: z.string().min(1).default('production'),
  platform: z.enum(['ios', 'android']).optional(),
  nativeVersion: z.string().min(1).optional(),
  currentVersion: z.string().min(1).optional(),
})

const projectConfigSchema = projectConfigFileSchema.transform(({ currentVersion, nativeVersion, ...rest }) => ({
  ...rest,
  nativeVersion: nativeVersion ?? currentVersion,
}))

export type GlobalConfig = z.infer<typeof globalConfigSchema>
export type ProjectConfig = z.infer<typeof projectConfigSchema>
export type Target = ProjectConfig['target']
export type MobilePlatform = NonNullable<ProjectConfig['platform']>

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
    target: parsed.target,
    channel: parsed.channel,
    platform: parsed.platform,
    nativeVersion: parsed.nativeVersion,
  })
}
