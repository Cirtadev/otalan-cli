// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type ReleaseListItem = {
  id: string
  appId: string
  platform: 'ios' | 'android'
  channel: string
  nativeVersion: string
  bundleId: string
  storageObjectExists: boolean
  checksum: string | null
  mandatory: boolean
  rolloutPercent: number
  rolloutState: string
  releaseNotes: string | null
  isActive: boolean
  createdAt: string
  resolvedDownloadUrl: string | null
}

export type ReleaseContext = {
  organizationId: string
  organizationName: string
  organizationSlug: string
  projectId: string
  projectName: string
  projectSlug: string
}

type JsonObject = Record<string, unknown>

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

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

  throw new Error(message)
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export async function createRelease(input: {
  apiUrl: string
  apiKey: string
  appId: string
  platform: 'ios' | 'android'
  channel: string
  nativeVersion: string
  bundleId: string
  mandatory: boolean
  rolloutPercent: number
  releaseNotes?: string
  file: File
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

  formData.set('file', input.file)

  const response = await fetch(`${input.apiUrl.replace(/\/+$/, '')}/v1/releases/create`, {
    method: 'POST',
    headers: buildHeaders(input.apiKey),
    body: formData,
  })

  await assertResponseOk(response)
  return parseJson(response)
}

export async function getReleaseContext(input: {
  apiUrl: string
  apiKey: string
}) {
  const response = await fetch(`${input.apiUrl.replace(/\/+$/, '')}/v1/releases/context`, {
    headers: buildHeaders(input.apiKey),
  })

  await assertResponseOk(response)
  const payload = await parseJson(response)
  return payload.item as ReleaseContext
}

export async function publishRelease(input: {
  apiUrl: string
  apiKey: string
  appId: string
  platform: 'ios' | 'android'
  channel: string
  nativeVersion: string
  bundleId: string
  checksum: string
  mandatory: boolean
  rolloutPercent: number
  releaseNotes?: string
  storageKey?: string
  downloadUrl?: string
}) {
  const response = await fetch(`${input.apiUrl.replace(/\/+$/, '')}/v1/releases/publish`, {
    method: 'POST',
    headers: buildHeaders(input.apiKey, {
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({
      appId: input.appId,
      platform: input.platform,
      channel: input.channel,
      nativeVersion: input.nativeVersion,
      bundleId: input.bundleId,
      checksum: input.checksum,
      mandatory: input.mandatory,
      rolloutPercent: input.rolloutPercent,
      releaseNotes: input.releaseNotes,
      storageKey: input.storageKey,
      downloadUrl: input.downloadUrl,
    }),
  })

  await assertResponseOk(response)
  return parseJson(response)
}

export async function rollbackRelease(input: {
  apiUrl: string
  apiKey: string
  appId: string
  platform: 'ios' | 'android'
  channel: string
  nativeVersion: string
  targetBundleId: string
}) {
  const response = await fetch(`${input.apiUrl.replace(/\/+$/, '')}/v1/releases/rollback`, {
    method: 'POST',
    headers: buildHeaders(input.apiKey, {
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify(input),
  })

  await assertResponseOk(response)
  return parseJson(response)
}

export async function listReleases(input: {
  apiUrl: string
  apiKey: string
  appId: string
  platform?: 'ios' | 'android'
  channel?: string
  nativeVersion?: string
}) {
  const url = new URL(`${input.apiUrl.replace(/\/+$/, '')}/v1/releases`)

  url.searchParams.set('appId', input.appId)

  if (input.platform) {
    url.searchParams.set('platform', input.platform)
  }

  if (input.channel) {
    url.searchParams.set('channel', input.channel)
  }

  if (input.nativeVersion) {
    url.searchParams.set('nativeVersion', input.nativeVersion)
  }

  const response = await fetch(url, {
    headers: buildHeaders(input.apiKey),
  })

  await assertResponseOk(response)
  const payload = await parseJson(response)
  return (payload.items ?? []) as ReleaseListItem[]
}
