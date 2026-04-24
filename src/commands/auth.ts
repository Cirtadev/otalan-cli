import {
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
import { getReleaseContext } from '../http'
import { promptWithHint } from '../cli/prompts'

export async function handleLogin(options: Record<string, string | boolean>) {
  const apiUrl = readStringOption(options, 'api-url') ?? await promptWithHint({
    question: 'Otalan API URL',
    fallback: 'https://api.otalan.com',
    hint: 'API base URL. Use https://api.otalan.com for production or http://localhost:8787 for local development.',
  })
  const apiKeysUrl = resolveApiKeysUrl(apiUrl)

  if (!readStringOption(options, 'api-key')) {
    console.log('')
    console.log(`Get your CI key from: ${apiKeysUrl}`)
  }

  const apiKey = readStringOption(options, 'api-key') ?? await promptWithHint({
    question: 'CI key',
    hint: 'Project CI key for publish, rollback, status, and bundle listing. Do not use an OTA app key.',
    example: 'otalan_ci_xxxxxxxxx',
  })

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

export async function handleInit(context: CommandContext, options: Record<string, string | boolean>) {
  const api = await resolveApiConfig(options).catch(() => null)
  const releaseContext = api
    ? await getReleaseContext({
      apiUrl: api.apiUrl,
      apiKey: api.apiKey,
    }).catch(() => null)
    : null
  const appId = readStringOption(options, 'app-id') ?? await promptWithHint({
    question: 'App ID',
    hint: 'Active registered app ID from the Apps page. It is resolved within the project linked to the CI key.',
  })

  await saveProjectConfig(context.cwd, {
    organizationSlug: releaseContext?.organizationSlug,
    projectSlug: releaseContext?.projectSlug,
    appId,
  } satisfies ProjectConfig)

  if (releaseContext) {
    console.log('')
    console.log(`Resolved CI key context: ${releaseContext.organizationSlug} / ${releaseContext.projectSlug}`)
  }

  console.log('Created otalan.config.json.')
}
