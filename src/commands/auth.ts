import {
  loadGlobalConfig,
  saveGlobalConfig,
  saveProjectConfig,
  type ProjectConfig,
} from '../config'
import { readStringOption } from '../cli/args'
import {
  resolveApiConfig,
  resolveApiKeysUrl,
  type CommandContext,
} from '../cli/helpers'
import { getReleaseContext, listReleaseApps, type ReleaseAppItem } from '../http'
import { promptSelectWithHint, promptWithHint, type PromptWithHintInput } from '../cli/prompts'

// -----------------------------------------------------------------------------
// Login helpers
// -----------------------------------------------------------------------------

type TextPrompt = (input: PromptWithHintInput) => Promise<string>

function maskApiKey(apiKey: string) {
  const trimmed = apiKey.trim()

  if (trimmed.length <= 12) {
    return '********'
  }

  return `${trimmed.slice(0, 10)}...${trimmed.slice(-4)}`
}

async function resolveLoginInput(options: Record<string, string | boolean>, prompt: TextPrompt = promptWithHint) {
  const stored = await loadGlobalConfig().catch(() => null)
  const apiUrl = readStringOption(options, 'api-url') ?? await prompt({
    question: 'Otalan API URL',
    fallback: stored?.apiUrl ?? 'https://api.otalan.com',
    hint: 'API base URL. Press Enter to keep the current value.',
  })
  const explicitApiKey = readStringOption(options, 'api-key')

  if (explicitApiKey) {
    return {
      apiUrl,
      apiKey: explicitApiKey,
    }
  }

  const apiKeysUrl = resolveApiKeysUrl()

  console.log('')
  console.log(`Get your CI key from: ${apiKeysUrl}`)

  const apiKey = await prompt({
    question: 'CI key',
    hint: [
      'Project CI key for publish, rollback, status, and bundle listing. Do not use an OTA app key.',
      stored?.apiKey ? `Current CI key: ${maskApiKey(stored.apiKey)}` : undefined,
      stored?.apiKey ? 'Press Enter to keep the current CI key.' : undefined,
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

// -----------------------------------------------------------------------------
// Commands
// -----------------------------------------------------------------------------

export async function handleLogin(options: Record<string, string | boolean>) {
  const { apiKey, apiUrl } = await resolveLoginInput(options)

  await saveGlobalConfig({
    apiKey,
    apiUrl,
  })

  const context = await getReleaseContext({
    apiUrl,
    apiKey,
  }).catch(() => null)

  if (context) {
    console.log('')
    console.log(`Resolved CI key context: ${context.organizationSlug} / ${context.projectSlug}`)
  }

  console.log('')
  console.log('Saved CLI auth.')
}

export async function handleDoctor(options: Record<string, string | boolean>) {
  const api = await resolveApiConfig(options)
  const context = await getReleaseContext({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
  })

  console.log('Otalan API connection OK.')
  console.log(`API URL: ${api.apiUrl}`)
  console.log(`Organization: ${context.organizationSlug}`)
  console.log(`Project: ${context.projectSlug}`)
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

  await saveProjectConfig(context.cwd, {
    organizationSlug: releaseContext.organizationSlug,
    projectSlug: releaseContext.projectSlug,
    appId,
  } satisfies ProjectConfig)

  console.log('')
  console.log(`Resolved CI key context: ${releaseContext.organizationSlug} / ${releaseContext.projectSlug}`)
  console.log(`Linked app: ${appId}`)

  console.log('Created otalan.config.json.')
}

export const authCommandTestUtils = {
  findAppByAppId,
  formatAppOption,
  maskApiKey,
  resolveInitAppId,
}
