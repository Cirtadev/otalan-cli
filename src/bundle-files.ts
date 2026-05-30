import { createHash } from 'node:crypto'
import { mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'

import { zipSync } from 'fflate'

import { assertNoNativeBundleEntries } from './bundle-validation'
import {
  LEGACY_BUNDLE_ARCHIVE_FILE_NAME,
  type BundleManifest,
  type CollectDirectoryEntriesOptions,
  type ZipDirectoryResult,
} from './bundle-types'
import { createBundleArchiveFileName } from './bundle-id'

const ZIP_COMPRESSION_LEVEL = 6

export async function pathExists(filePath: string) {
  return Bun.file(filePath).exists()
}

export async function readTextFileIfExists(filePath: string) {
  if (!(await pathExists(filePath))) {
    return null
  }

  return Bun.file(filePath).text()
}

export async function pathIsDirectory(directoryPath: string) {
  try {
    await readdir(directoryPath)
    return true
  } catch {
    return false
  }
}

export async function collectDirectoryEntries(
  rootDir: string,
  currentDir = rootDir,
  options: CollectDirectoryEntriesOptions = {},
) {
  const entries: Record<string, Uint8Array> = {}
  const items = (await readdir(currentDir, { withFileTypes: true }))
    .sort((left, right) => {
      if (left.name < right.name) {
        return -1
      }

      if (left.name > right.name) {
        return 1
      }

      return 0
    })

  for (const item of items) {
    const absolutePath = path.join(currentDir, item.name)

    if (item.isDirectory()) {
      const nestedEntries = await collectDirectoryEntries(rootDir, absolutePath, options)

      Object.assign(entries, nestedEntries)
      continue
    }

    if (!item.isFile()) {
      continue
    }

    const relativePath = path
      .relative(rootDir, absolutePath)
      .split(path.sep)
      .join(path.posix.sep)

    if (options.shouldOmitFile?.(relativePath)) {
      options.omittedPaths?.push(relativePath)
      continue
    }

    entries[relativePath] = new Uint8Array(await Bun.file(absolutePath).arrayBuffer())
  }

  return entries
}

export function hashBytes(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

export async function readPackageVersion(cwd: string) {
  const packageJsonPath = path.join(cwd, 'package.json')

  if (!(await pathExists(packageJsonPath))) {
    return undefined
  }

  const raw = JSON.parse(await Bun.file(packageJsonPath).text()) as {
    version?: string
  }

  return raw.version
}

function isSourceMapPath(relativePath: string) {
  return relativePath.endsWith('.map')
}

function zipEntries(entries: Record<string, Uint8Array>) {
  return zipSync(entries, {
    level: ZIP_COMPRESSION_LEVEL,
  })
}

export async function zipDirectory(directoryPath: string): Promise<ZipDirectoryResult> {
  const omittedSourceMapPaths: string[] = []
  const entries = await collectDirectoryEntries(directoryPath, directoryPath, {
    shouldOmitFile: isSourceMapPath,
    omittedPaths: omittedSourceMapPaths,
  })

  if (Object.keys(entries).length === 0) {
    if (omittedSourceMapPaths.length > 0) {
      throw new Error(`No bundle files found in ${directoryPath} after omitting ${omittedSourceMapPaths.length} source map file(s).`)
    }

    throw new Error(`No files found in ${directoryPath}`)
  }

  assertNoNativeBundleEntries(directoryPath, Object.keys(entries))

  return {
    bytes: await zipEntries(entries),
    omittedSourceMapCount: omittedSourceMapPaths.length,
  }
}

export async function writeBundleOutput(
  outputDir: string,
  bundleBytes: Uint8Array,
  manifest: BundleManifest,
) {
  const archiveFileName = createBundleArchiveFileName(manifest.bundleId)

  await mkdir(outputDir, { recursive: true })
  await rm(path.join(outputDir, LEGACY_BUNDLE_ARCHIVE_FILE_NAME), { force: true })
  await Bun.write(path.join(outputDir, archiveFileName), bundleBytes)
  await Bun.write(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  return archiveFileName
}
