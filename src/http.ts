import type { MobilePlatform } from './config'

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type ReleaseItem = {
  id: string
  projectId: string
  appId: string
  platform: MobilePlatform
  channel: string
  nativeVersion: string
  bundleId: string
  storageKey: string | null
  downloadUrl: string | null
  checksum: string | null
  mandatory: boolean
  rolloutPercent: number
  rolloutState: string
  releaseNotes: string | null
  fileSizeBytes: number | null
  storageObjectExists: boolean
  isActive: boolean
  createdAt: string
  resolvedDownloadUrl: string | null
}

type JsonObject = Record<string, unknown>

export type ReleaseContext = {
  organizationId: string
  organizationName: string
  organizationSlug: string
  projectId: string
  projectName: string
  projectSlug: string
}

export type BundleIngestItem = {
  id: string
  appId: string
  platform: MobilePlatform
  channel: string
  nativeVersion: string
  bundleId: string
  status: string
  failureReason: string | null
  checksum: string | null
  mandatory: boolean
  rolloutPercent: number
  releaseNotes: string | null
  fileSizeBytes: number
  processedAt: string | null
  createdAt: string
}

type ReleaseClientConfig = {
  apiUrl: string
  apiKey: string
}

type ReleaseIdentity = {
  appId: string
  platform: MobilePlatform
  channel: string
  nativeVersion: string
  bundleId: string
}

type ReleasePublishMetadata = {
  mandatory: boolean
  rolloutPercent: number
  releaseNotes?: string
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function normalizeApiUrl(apiUrl: string) {
  return apiUrl.replace(/\/+$/, '')
}

function buildHeaders(apiKey: string, extra?: HeadersInit) {
  return {
    'x-api-key': apiKey,
    ...extra,
  }
}

async function parseJson(response: Response) {
  return response.json() as Promise<JsonObject>
}

async function assertResponseOk(response: Response) {
  if (response.ok) {
    return
  }

  const payload = await parseJson(response).catch(() => ({} as JsonObject))
  const messageValue = payload.message
  const message = typeof messageValue === 'string'
    ? messageValue
    : `Request failed with status ${response.status}`

  if (message === 'App not found in selected project') {
    throw new Error(`${message}. Check that appId is correct and the app is not archived.`)
  }

  throw new Error(message)
}

async function requestJson<T>(input: {
  apiUrl: string
  apiKey: string
  path: string
  method?: 'GET' | 'POST'
  query?: Record<string, string | undefined>
  body?: unknown
}) {
  const url = new URL(`${normalizeApiUrl(input.apiUrl)}${input.path}`)

  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value) {
      url.searchParams.set(key, value)
    }
  }

  const response = await fetch(url, {
    method: input.method ?? 'GET',
    headers: input.body
      ? buildHeaders(input.apiKey, { 'Content-Type': 'application/json' })
      : buildHeaders(input.apiKey),
    body: input.body ? JSON.stringify(input.body) : undefined,
  })

  await assertResponseOk(response)
  return response.json() as Promise<T>
}

async function requestForm<T>(input: {
  apiUrl: string
  apiKey: string
  path: string
  formData: FormData
}) {
  const response = await fetch(`${normalizeApiUrl(input.apiUrl)}${input.path}`, {
    method: 'POST',
    headers: buildHeaders(input.apiKey),
    body: input.formData,
  })

  await assertResponseOk(response)
  return response.json() as Promise<T>
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export async function createRelease(input: ReleaseClientConfig & ReleaseIdentity & ReleasePublishMetadata & {
  file: File
  expoConfig?: JsonObject
}) {
  const formData = new FormData()

  formData.set('appId', input.appId)
  formData.set('platform', input.platform)
  formData.set('channel', input.channel)
  formData.set('nativeVersion', input.nativeVersion)
  formData.set('bundleId', input.bundleId)
  formData.set('mandatory', String(input.mandatory))
  formData.set('rolloutPercent', String(input.rolloutPercent))

  if (input.releaseNotes) {
    formData.set('releaseNotes', input.releaseNotes)
  }

  if (input.expoConfig) {
    formData.set('expoConfig', JSON.stringify(input.expoConfig))
  }

  formData.set('file', input.file)

  const payload = await requestForm<{
    item: BundleIngestItem
  }>({
    apiUrl: input.apiUrl,
    apiKey: input.apiKey,
    path: '/v1/releases/create',
    formData,
  })

  return payload.item
}

export async function getReleaseContext(input: ReleaseClientConfig) {
  const payload = await requestJson<{
    item: ReleaseContext
  }>({
    apiUrl: input.apiUrl,
    apiKey: input.apiKey,
    path: '/v1/releases/context',
  })

  return payload.item
}

export async function getReleaseIngest(input: ReleaseClientConfig & {
  ingestId: string
}) {
  const payload = await requestJson<{
    item: BundleIngestItem
  }>({
    apiUrl: input.apiUrl,
    apiKey: input.apiKey,
    path: `/v1/releases/ingests/${encodeURIComponent(input.ingestId)}`,
  })

  return payload.item
}

export async function rollbackRelease(input: ReleaseClientConfig & {
  appId: string
  platform: MobilePlatform
  channel: string
  nativeVersion: string
  targetBundleId: string
}) {
  const payload = await requestJson<{
    item: ReleaseItem
  }>({
    apiUrl: input.apiUrl,
    apiKey: input.apiKey,
    path: '/v1/releases/rollback',
    method: 'POST',
    body: {
      appId: input.appId,
      platform: input.platform,
      channel: input.channel,
      nativeVersion: input.nativeVersion,
      targetBundleId: input.targetBundleId,
    },
  })

  return payload.item
}

export async function listReleases(input: ReleaseClientConfig & {
  appId: string
  platform?: MobilePlatform
  channel?: string
  nativeVersion?: string
  bundleId?: string
}) {
  const payload = await requestJson<{
    items: ReleaseItem[]
  }>({
    apiUrl: input.apiUrl,
    apiKey: input.apiKey,
    path: '/v1/releases',
    query: {
      appId: input.appId,
      platform: input.platform,
      channel: input.channel,
      nativeVersion: input.nativeVersion,
      bundleId: input.bundleId,
    },
  })

  return payload.items
}
