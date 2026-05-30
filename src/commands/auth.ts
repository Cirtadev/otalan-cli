import {
  DEFAULT_API_URL,
  loadGlobalConfig,
  saveGlobalConfig,
  saveProjectConfig,
  type GlobalConfig,
  type ProjectConfig,
} from '../config'
import { readStringOption } from '../cli/args'
import {
  resolveApiConfig,
  resolveApiKeysUrl,
  type CommandContext,
} from '../cli/helpers'
import { formatKeyValueTable } from '../cli/table'
import { getReleaseContext, listReleaseApps, type ReleaseAppItem } from '../http'
import { promptSelectWithHint, promptWithHint, type PromptWithHintInput } from '../cli/prompts'
import { printSuccess } from '../cli/ui'

type TextPrompt = (input: PromptWithHintInput) => Promise<string>
type GlobalConfigLoader = () => Promise<GlobalConfig>
type ReleaseContextLoader = typeof getReleaseContext
type GlobalConfigSaver = typeof saveGlobalConfig

function maskApiKey(apiKey: string) {
  const trimmed = apiKey.trim()

  if (trimmed.length <= 12) {
    return '********'
  }

  return `${trimmed.slice(0, 10)}...${trimmed.slice(-4)}`
}

async function resolveLoginInput(
  options: Record<string, string | boolean>,
  prompt: TextPrompt = promptWithHint,
  loadConfig: GlobalConfigLoader = loadGlobalConfig,
) {
  const stored = await loadConfig().catch(() => null)
  const explicitApiUrl = readStringOption(options, 'api-url')
  const explicitApiKey = readStringOption(options, 'api-key')
  const fallbackApiUrl = stored?.apiUrl ?? DEFAULT_API_URL

  if (explicitApiKey) {
    return {
      apiUrl: explicitApiUrl ?? fallbackApiUrl,
      apiKey: explicitApiKey,
    }
  }

  const apiUrl = explicitApiUrl ?? await prompt({
    question: 'Otalan API URL',
    fallback: fallbackApiUrl,
    hint: `API base URL. Otalan default: ${DEFAULT_API_URL}.`,
  })

  const apiKeysUrl = resolveApiKeysUrl(apiUrl)

  console.log('')
  console.log(`Get your OTA Publish Key from: ${apiKeysUrl}`)

  const apiKey = await prompt({
    question: 'OTA Publish Key',
    secret: true,
    hint: [
      'Project OTA Publish Key for publish, rollback, status, and bundle listing. Do not use an OTA App Key.',
      stored?.apiKey ? `Current OTA Publish Key: ${maskApiKey(stored.apiKey)}` : undefined,
    ].filter(Boolean).join('\n'),
    example: stored?.apiKey ? undefined : 'otalan_ci_xxxxxxxxx',
  })

  return {
    apiUrl,
    apiKey: apiKey.trim() || stored?.apiKey || '',
  }
}

function findAppByAppId(apps: ReleaseAppItem[], appId: string) {
  return apps.find(app => app.appId === appId)
}

function formatAppOption(app: ReleaseAppItem) {
  return app.name === app.appId
    ? app.appId
    : `${app.name} (${app.appId})`
}

async function resolveInitAppId(input: {
  apps: ReleaseAppItem[]
  options: Record<string, string | boolean>
}) {
  const explicitAppId = readStringOption(input.options, 'app-id')

  if (explicitAppId) {
    const app = findAppByAppId(input.apps, explicitAppId)

    if (!app) {
      throw new Error(`App "${explicitAppId}" was not found in the logged-in project, or it is archived.`)
    }

    return app.appId
  }

  if (input.apps.length === 0) {
    throw new Error('No active apps found in the logged-in project. Create or restore an app before running `otalan init`.')
  }

  return promptSelectWithHint({
    question: 'App',
    fallback: input.apps[0]?.appId,
    hint: 'Select the active app to link with this repo.',
    options: input.apps.map(app => ({
      label: formatAppOption(app),
      value: app.appId,
    })),
  })
}

async function validateAndSaveLogin(input: {
  apiKey: string
  apiUrl: string
  loadContext?: ReleaseContextLoader
  saveConfig?: GlobalConfigSaver
}) {
  const loadContext = input.loadContext ?? getReleaseContext
  const saveConfig = input.saveConfig ?? saveGlobalConfig
  const context = await loadContext({
    apiUrl: input.apiUrl,
    apiKey: input.apiKey,
  })

  await saveConfig({
    apiKey: input.apiKey,
    apiUrl: input.apiUrl,
  })

  return context
}

export async function handleLogin(options: Record<string, string | boolean>) {
  const { apiKey, apiUrl } = await resolveLoginInput(options)
  const context = await validateAndSaveLogin({
    apiUrl,
    apiKey,
  })

  console.log('')
  console.log(formatKeyValueTable([
    ['Organization', context.organizationSlug],
    ['Project', context.projectSlug],
  ]))

  console.log('')
  printSuccess('Saved CLI auth')
}

export async function handleDoctor(options: Record<string, string | boolean>) {
  const api = await resolveApiConfig(options)
  const context = await getReleaseContext({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
  })

  printSuccess('Otalan API connection OK')
  console.log(formatKeyValueTable([
    ['API URL', api.apiUrl],
    ['Organization', context.organizationSlug],
    ['Project', context.projectSlug],
  ]))
}

export async function handleInit(context: CommandContext, options: Record<string, string | boolean>) {
  const api = await resolveApiConfig(options)
  const [releaseContext, apps] = await Promise.all([
    getReleaseContext({
      apiUrl: api.apiUrl,
      apiKey: api.apiKey,
    }),
    listReleaseApps({
      apiUrl: api.apiUrl,
      apiKey: api.apiKey,
    }),
  ])
  const appId = await resolveInitAppId({ apps, options })
  const app = findAppByAppId(apps, appId)

  await saveProjectConfig(context.cwd, {
    organizationSlug: releaseContext.organizationSlug,
    projectSlug: releaseContext.projectSlug,
    appName: app?.name,
    appId,
  } satisfies ProjectConfig)

  console.log('')
  console.log(formatKeyValueTable([
    ['Organization', releaseContext.organizationSlug],
    ['Project', releaseContext.projectSlug],
    ['Linked app', app ? formatAppOption(app) : appId],
  ]))

  printSuccess('Created otalan.config.json')
}

export const authCommandTestUtils = {
  findAppByAppId,
  formatAppOption,
  maskApiKey,
  resolveInitAppId,
  resolveLoginInput,
  validateAndSaveLogin,
}
