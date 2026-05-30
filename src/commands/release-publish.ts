import { readBooleanOption, readStringOption } from '../cli/args'
import { openBundleArchive, type CommandContext } from '../cli/helpers'
import {
  formatIngestSummary,
  formatPublishedReleaseSummary,
  formatPublishSummary,
} from '../cli/output'
import { createProgressReporter } from '../cli/progress'
import { formatInfo } from '../cli/ui'
import {
  cancelReleaseUpload,
  completeReleaseUpload,
  createReleaseUploadIntent,
  getReleaseIngest,
  type BundleIngestItem,
  uploadReleaseArchive,
} from '../http'
import {
  formatReleaseAppOption,
  formatPublishSuccessMessage,
  isInteractiveTerminal,
  isVerboseOutput,
  resolveManifestExpoPublishMetadata,
  resolveReleaseAccess,
  resolveReleaseTupleFromManifest,
  resolveRolloutPercent,
  waitForReleaseIngest,
} from './release-shared'

export async function handlePublish(
  context: CommandContext,
  options: Record<string, string | boolean>,
) {
  const verbose = isVerboseOutput(options)
  const progress = verbose
    ? undefined
    : createProgressReporter({
      animated: isInteractiveTerminal(),
    })
  const { api, project } = await resolveReleaseAccess(context, options, {
    printSummary: verbose,
  })
  const { outputDir, manifest, platform, runtimeVersion, channel } = await resolveReleaseTupleFromManifest(context, options)
  const mandatory = !readBooleanOption(options, 'optional', false)
  const rolloutPercent = resolveRolloutPercent(options)
  const releaseNotes = readStringOption(options, 'release-notes')
  const appLabel = formatReleaseAppOption({
    name: project.appName ?? project.appId,
    appId: project.appId,
  })

  if (!verbose) {
    console.log('')
    console.log(formatInfo(
      `Publishing ${manifest.target} OTA bundle ${manifest.bundleId} to ${appLabel} `
      + `on ${platform}/${channel} (runtime ${runtimeVersion}, rollout ${rolloutPercent}%, `
      + `${mandatory ? 'mandatory' : 'optional'}).`,
    ))
  }

  const preparing = progress?.start('Preparing')
  let archive: Awaited<ReturnType<typeof openBundleArchive>>
  let uploadIntent: Awaited<ReturnType<typeof createReleaseUploadIntent>>

  try {
    archive = await openBundleArchive(outputDir, manifest)
    uploadIntent = await createReleaseUploadIntent({
      apiUrl: api.apiUrl,
      apiKey: api.apiKey,
      appId: project.appId,
      platform,
      channel,
      runtimeVersion,
      bundleId: manifest.bundleId,
      mandatory,
      rolloutPercent,
      releaseNotes,
      fileName: archive.fileName,
      fileSizeBytes: archive.fileSizeBytes,
      contentType: archive.contentType,
      expoManifest: resolveManifestExpoPublishMetadata(manifest),
    })
    preparing?.succeed()
  } catch (error) {
    preparing?.fail()
    throw error
  }

  const uploading = progress?.start('Uploading')

  try {
    await uploadReleaseArchive({
      uploadUrl: uploadIntent.uploadUrl,
      archive: archive.body,
      uploadHeaders: uploadIntent.uploadHeaders,
    })
  } catch (error) {
    await cancelReleaseUpload({
      apiUrl: api.apiUrl,
      apiKey: api.apiKey,
      ingestId: uploadIntent.item.id,
    }).catch(() => undefined)

    uploading?.fail()
    throw error
  }

  uploading?.succeed()

  const validating = progress?.start('Validating')
  let ingest: BundleIngestItem

  try {
    ingest = await completeReleaseUpload({
      apiUrl: api.apiUrl,
      apiKey: api.apiKey,
      ingestId: uploadIntent.item.id,
    })
  } catch (error) {
    validating?.fail()
    throw error
  }

  if (verbose) {
    console.log(formatPublishSummary({
      app: appLabel,
      archiveFileName: archive.fileName,
      archiveSizeBytes: archive.fileSizeBytes,
      bundleId: manifest.bundleId,
      platform,
      channel,
      runtimeVersion,
      rolloutPercent,
      mandatory,
      releaseNotes,
      target: manifest.target,
    }))
    console.log('')
    console.log(formatIngestSummary({
      ingest,
    }))
    console.log('')
    console.log(formatInfo('Waiting for validation...'))
  }

  let completedIngest: BundleIngestItem

  try {
    completedIngest = await waitForReleaseIngest({
      ingest,
      loadIngest: ingestId =>
        getReleaseIngest({
          apiUrl: api.apiUrl,
          apiKey: api.apiKey,
          ingestId,
        }),
      onStatusChange: nextIngest => {
        if (!verbose) {
          return
        }

        console.log(formatInfo(`Ingest status: ${nextIngest.status}`))
      },
    })
  } catch (error) {
    validating?.fail()
    throw error
  }

  if (completedIngest.status === 'failed') {
    validating?.fail()

    if (completedIngest.failureReason) {
      throw new Error(`Release validation failed for ingest ${completedIngest.id}: ${completedIngest.failureReason}`)
    }

    throw new Error(`Release validation failed for ingest ${completedIngest.id}.`)
  }

  validating?.succeed()

  const activating = progress?.start('Activating')

  activating?.succeed()

  console.log('')
  console.log(formatPublishSuccessMessage())
  console.log(formatPublishedReleaseSummary({
    app: appLabel,
    archiveFileName: archive.fileName,
    archiveSizeBytes: archive.fileSizeBytes,
    ingest: completedIngest,
    releaseNotes,
    target: manifest.target,
  }))
}
