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
  runtimeVersion: string
  bundleId: string
  releaseStorageId: string
  checksum: string | null
  mandatory: boolean
  rolloutPercent: number
  rolloutState: string
  releaseNotes: string | null
  fileSizeBytes: number | null
  storageObjectExists: boolean
  isActive: boolean
  publishedAt: string
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

export type ReleaseAppItem = {
  name: string
  appId: string
}

export type BundleIngestItem = {
  id: string
  appId: string
  platform: MobilePlatform
  channel: string
  runtimeVersion: string
  bundleId: string
  releaseStorageId: string
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
  runtimeVersion: string
  bundleId: string
}

type ReleaseTuple = Omit<ReleaseIdentity, 'bundleId'>

type ReleasePublishMetadata = {
  mandatory: boolean
  rolloutPercent: number
  releaseNotes?: string
}

type ReleaseArchiveMetadata = {
  fileName: string
  fileSizeBytes: number
  contentType?: string
  expoManifest?: string
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

async function assertDirectUploadResponseOk(response: Response) {
  if (response.ok) {
    return
  }

  const body = await response.text().catch(() => '')
  const message = body.trim()
    ? `Direct bundle upload failed with status ${response.status}: ${body.trim()}`
    : `Direct bundle upload failed with status ${response.status}`

  throw new Error(message)
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export async function createReleaseUploadIntent(
  input: ReleaseClientConfig & ReleaseIdentity & ReleasePublishMetadata & ReleaseArchiveMetadata,
) {
  const payload = await requestJson<{
    item: BundleIngestItem
    uploadUrl: string
    contentType: string
  }>({
    apiUrl: input.apiUrl,
    apiKey: input.apiKey,
    path: '/v1/releases/create',
    method: 'POST',
    body: {
      appId: input.appId,
      platform: input.platform,
      channel: input.channel,
      runtimeVersion: input.runtimeVersion,
      bundleId: input.bundleId,
      mandatory: input.mandatory,
      rolloutPercent: input.rolloutPercent,
      ...(input.releaseNotes ? { releaseNotes: input.releaseNotes } : {}),
      ...(input.expoManifest ? { expoManifest: input.expoManifest } : {}),
      fileName: input.fileName,
      fileSizeBytes: input.fileSizeBytes,
      ...(input.contentType ? { contentType: input.contentType } : {}),
    },
  })

  return payload
}

export async function uploadReleaseArchive(input: {
  uploadUrl: string
  archive: Blob
  contentType: string
}) {
  const response = await fetch(input.uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': input.contentType,
    },
    body: input.archive,
  })

  await assertDirectUploadResponseOk(response)
}

export async function completeReleaseUpload(input: ReleaseClientConfig & {
  ingestId: string
}) {
  const payload = await requestJson<{
    item: BundleIngestItem
  }>({
    apiUrl: input.apiUrl,
    apiKey: input.apiKey,
    path: `/v1/releases/ingests/${encodeURIComponent(input.ingestId)}/complete`,
    method: 'POST',
  })

  return payload.item
}

export async function cancelReleaseUpload(input: ReleaseClientConfig & {
  ingestId: string
}) {
  const payload = await requestJson<{
    item: BundleIngestItem
  }>({
    apiUrl: input.apiUrl,
    apiKey: input.apiKey,
    path: `/v1/releases/ingests/${encodeURIComponent(input.ingestId)}/cancel`,
    method: 'POST',
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

export async function listReleaseApps(input: ReleaseClientConfig) {
  const payload = await requestJson<{
    items: ReleaseAppItem[]
  }>({
    apiUrl: input.apiUrl,
    apiKey: input.apiKey,
    path: '/v1/releases/apps',
  })

  return payload.items
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
  runtimeVersion: string
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
      runtimeVersion: input.runtimeVersion,
      targetBundleId: input.targetBundleId,
    },
  })

  return payload.item
}

async function updateReleaseRolloutState(input: ReleaseClientConfig & ReleaseTuple & {
  action: 'pause' | 'resume'
}) {
  const payload = await requestJson<{
    item: ReleaseItem
  }>({
    apiUrl: input.apiUrl,
    apiKey: input.apiKey,
    path: `/v1/releases/${input.action}`,
    method: 'POST',
    body: {
      appId: input.appId,
      platform: input.platform,
      channel: input.channel,
      runtimeVersion: input.runtimeVersion,
    },
  })

  return payload.item
}

export async function pauseRelease(input: ReleaseClientConfig & ReleaseTuple) {
  return updateReleaseRolloutState({
    ...input,
    action: 'pause',
  })
}

export async function resumeRelease(input: ReleaseClientConfig & ReleaseTuple) {
  return updateReleaseRolloutState({
    ...input,
    action: 'resume',
  })
}

export async function listReleases(input: ReleaseClientConfig & {
  appId: string
  platform?: MobilePlatform
  channel?: string
  runtimeVersion?: string
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
      runtimeVersion: input.runtimeVersion,
      bundleId: input.bundleId,
    },
  })

  return payload.items
}
