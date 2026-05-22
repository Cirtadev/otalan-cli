import { chmod, mkdir, writeFile } from 'node:fs/promises'
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
  appName: z.string().min(1).optional(),
  appId: z.string().min(1),
})

export type GlobalConfig = z.infer<typeof globalConfigSchema>
export type ProjectConfig = z.infer<typeof projectConfigSchema>

// -----------------------------------------------------------------------------
// Paths
// -----------------------------------------------------------------------------

export const PROJECT_CONFIG_FILE = 'otalan.config.json'

function getGlobalConfigPath(homeDir = os.homedir()) {
  return path.join(homeDir, '.otalan', 'config.json')
}

// -----------------------------------------------------------------------------
// JSON helpers
// -----------------------------------------------------------------------------

async function readJsonFile<T>(filePath: string, schema: z.ZodType<T>) {
  const raw = await Bun.file(filePath).text()
  return schema.parse(JSON.parse(raw))
}

async function writeJsonFile(filePath: string, value: unknown, options: { dirMode?: number, mode?: number } = {}) {
  const directoryPath = path.dirname(filePath)

  await mkdir(directoryPath, {
    recursive: true,
    ...(options.dirMode === undefined ? {} : { mode: options.dirMode }),
  })

  if (options.dirMode !== undefined) {
    await chmod(directoryPath, options.dirMode)
  }

  const content = `${JSON.stringify(value, null, 2)}\n`

  if (options.mode !== undefined) {
    await writeFile(filePath, content, {
      mode: options.mode,
    })
    await chmod(filePath, options.mode)
    return
  }

  await Bun.write(filePath, content)
}

// -----------------------------------------------------------------------------
// Public helpers
// -----------------------------------------------------------------------------

export async function loadGlobalConfig() {
  return readJsonFile(getGlobalConfigPath(), globalConfigSchema)
}

export async function saveGlobalConfig(config: GlobalConfig, options: { homeDir?: string } = {}) {
  await writeJsonFile(getGlobalConfigPath(options.homeDir), globalConfigSchema.parse(config), {
    dirMode: 0o700,
    mode: 0o600,
  })
}

export async function loadProjectConfig(cwd: string) {
  return readJsonFile(path.join(cwd, PROJECT_CONFIG_FILE), projectConfigSchema)
}

export async function saveProjectConfig(cwd: string, config: ProjectConfig) {
  const parsed = projectConfigSchema.parse(config)
  await writeJsonFile(path.join(cwd, PROJECT_CONFIG_FILE), {
    organizationSlug: parsed.organizationSlug,
    projectSlug: parsed.projectSlug,
    appName: parsed.appName,
    appId: parsed.appId,
  })
}
