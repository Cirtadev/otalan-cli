import type { MobilePlatform } from './config'

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

export type ReleasePaginationMeta = {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
  hasPreviousPage: boolean
  hasNextPage: boolean
}

export type ReleaseListPage = {
  items: ReleaseItem[]
  pagination: ReleasePaginationMeta
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

export type ReleaseChannelAppItem = {
  appId: string
  name: string
}

export type ReleaseChannelItem = {
  channel: string
  apps: ReleaseChannelAppItem[]
}

type ReleaseChannelResponseItem = {
  channel?: unknown
  apps?: unknown
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

type StorageUploadHeaders = Record<string, string>

const MAX_ERROR_BODY_LENGTH = 500

function normalizeApiUrl(apiUrl: string) {
  return apiUrl.replace(/\/+$/, '')
}

function buildHeaders(apiKey: string, extra?: HeadersInit) {
  return {
    'x-api-key': apiKey,
    ...extra,
  }
}

function truncateErrorBody(body: string) {
  return body.length > MAX_ERROR_BODY_LENGTH
    ? `${body.slice(0, MAX_ERROR_BODY_LENGTH)}...`
    : body
}

async function assertResponseOk(response: Response) {
  if (response.ok) {
    return
  }

  const body = await response.text().catch(() => '')
  const trimmedBody = body.trim()
  const payload = trimmedBody
    ? (() => {
      try {
        return JSON.parse(trimmedBody) as JsonObject
      } catch {
        return {} as JsonObject
      }
    })()
    : {}
  const messageValue = payload.message
  const fallbackMessage = trimmedBody
    ? `Request failed with status ${response.status}: ${truncateErrorBody(trimmedBody)}`
    : `Request failed with status ${response.status}`
  const message = typeof messageValue === 'string' ? messageValue : fallbackMessage

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
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
}) {
  const url = new URL(`${normalizeApiUrl(input.apiUrl)}${input.path}`)

  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value))
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

function assertRequiredStorageUploadHeaders(uploadHeaders: StorageUploadHeaders) {
  const headers = new Headers(uploadHeaders)
  const contentType = headers.get('Content-Type')?.trim()
  const contentLength = headers.get('Content-Length')?.trim()

  if (!contentType || !contentLength) {
    throw new Error('Upload intent is missing required storage upload headers')
  }
}

function isLocalHttpUploadUrl(url: URL) {
  return url.protocol === 'http:'
    && (
      url.hostname === 'localhost'
      || url.hostname === '127.0.0.1'
      || url.hostname === '[::1]'
      || url.hostname === '::1'
    )
}

function assertSecureUploadUrl(uploadUrl: string) {
  const url = new URL(uploadUrl)

  if (url.protocol === 'https:' || isLocalHttpUploadUrl(url)) {
    return
  }

  throw new Error('Refusing to upload bundle over non-HTTPS URL.')
}

function normalizeReleaseChannelApps(item: ReleaseChannelResponseItem, channelIndex: number) {
  if (!Array.isArray(item.apps)) {
    throw new Error(`Release channel response item ${channelIndex + 1} is missing apps.`)
  }

  return item.apps
    .map((app, appIndex) => {
      if (
        app
        && typeof app === 'object'
        && 'appId' in app
        && 'name' in app
        && typeof app.appId === 'string'
        && typeof app.name === 'string'
      ) {
        return {
          appId: app.appId,
          name: app.name,
        }
      }

      throw new Error(`Release channel response item ${channelIndex + 1} app ${appIndex + 1} is invalid.`)
    })
    .sort((left, right) => left.name.localeCompare(right.name) || left.appId.localeCompare(right.appId))
}

function normalizeReleaseChannels(items: ReleaseChannelResponseItem[]): ReleaseChannelItem[] {
  return items
    .map((item, index) => {
      if (typeof item.channel === 'string') {
        return {
          channel: item.channel,
          apps: normalizeReleaseChannelApps(item, index),
        }
      }

      throw new Error(`Release channel response item ${index + 1} is invalid.`)
    })
    .sort((left, right) => left.channel.localeCompare(right.channel))
}

export async function createReleaseUploadIntent(
  input: ReleaseClientConfig & ReleaseIdentity & ReleasePublishMetadata & ReleaseArchiveMetadata,
) {
  const payload = await requestJson<{
    item: BundleIngestItem
    uploadUrl: string
    contentType: string
    uploadHeaders: StorageUploadHeaders
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
  uploadHeaders: StorageUploadHeaders
}) {
  assertRequiredStorageUploadHeaders(input.uploadHeaders)
  assertSecureUploadUrl(input.uploadUrl)

  const response = await fetch(input.uploadUrl, {
    method: 'PUT',
    headers: input.uploadHeaders,
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

export async function listReleaseChannels(input: ReleaseClientConfig & {
  appId?: string
}) {
  const payload = await requestJson<{
    items: ReleaseChannelResponseItem[]
  }>({
    apiUrl: input.apiUrl,
    apiKey: input.apiKey,
    path: '/v1/releases/channels',
    query: {
      appId: input.appId,
    },
  })

  return normalizeReleaseChannels(payload.items)
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
  page?: number
  pageSize?: number
}) {
  const payload = await requestJson<ReleaseListPage>({
    apiUrl: input.apiUrl,
    apiKey: input.apiKey,
    path: '/v1/releases',
    query: {
      appId: input.appId,
      platform: input.platform,
      channel: input.channel,
      runtimeVersion: input.runtimeVersion,
      bundleId: input.bundleId,
      page: input.page,
      pageSize: input.pageSize,
    },
  })

  return payload
}
