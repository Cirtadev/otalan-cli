import path from 'node:path'

import type { MobilePlatform } from './config'
import { readTextFileIfExists } from './bundle-files'
import {
  readExpoConfig,
  resolveExpoConfiguredVersion,
  resolveExpoRuntimeVersion,
} from './bundle-expo'

function extractIosPlistString(contents: string, key: string) {
  const match = contents.match(new RegExp(`<key>\\s*${key}\\s*<\\/key>\\s*<string>\\s*([^<]+?)\\s*<\\/string>`, 's'))
  return match?.[1]?.trim()
}

function extractXcodeBuildSettingReference(value: string) {
  const match = value.trim().match(/^\$\(([^):]+)(?::[^)]+)?\)$|^\$\{([^}:]+)(?::[^}]+)?\}$/)
  return match?.[1] ?? match?.[2]
}

function extractXcodeBuildSettingValue(contents: string, key: string) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [
    ...contents.matchAll(new RegExp(`\\b${escapedKey}\\s*=\\s*([^;\\n]+)\\s*;`, 'g')),
    ...contents.matchAll(new RegExp(`^\\s*${escapedKey}\\s*=\\s*(.+?)\\s*$`, 'gm')),
  ]
  const value = matches.at(-1)?.[1]?.trim()

  if (!value) {
    return undefined
  }

  return value
    .replace(/;\s*$/, '')
    .replace(/^["']|["']$/g, '')
    .trim()
}

async function resolveIosBuildSetting(
  cwd: string,
  key: string,
  seen = new Set<string>(),
): Promise<string | undefined> {
  if (seen.has(key)) {
    return undefined
  }

  const nextSeen = new Set(seen)
  nextSeen.add(key)
  const candidates = [
    path.join(cwd, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj'),
    path.join(cwd, 'ios', 'App.xcodeproj', 'project.pbxproj'),
  ]

  for (const candidate of candidates) {
    const contents = await readTextFileIfExists(candidate)

    if (!contents) {
      continue
    }

    const value = extractXcodeBuildSettingValue(contents, key)

    if (!value) {
      continue
    }

    const nestedReference = extractXcodeBuildSettingReference(value)

    if (!nestedReference) {
      return value
    }

    const resolvedNestedValue: string | undefined = await resolveIosBuildSetting(
      cwd,
      nestedReference,
      nextSeen,
    )

    if (resolvedNestedValue) {
      return resolvedNestedValue
    }
  }

  return undefined
}

async function resolveIosVersionValue(cwd: string, value: string) {
  const buildSettingReference = extractXcodeBuildSettingReference(value)

  if (!buildSettingReference) {
    return value
  }

  const resolvedValue = await resolveIosBuildSetting(cwd, buildSettingReference)

  if (resolvedValue) {
    return resolvedValue
  }

  throw new Error(`Unable to resolve iOS runtime version placeholder "${value}". Pass --runtime-version or ensure ${buildSettingReference} is defined in the Xcode project.`)
}

export async function resolveIosRuntimeVersion(cwd: string, runtimeVersion?: string) {
  if (runtimeVersion) {
    return runtimeVersion
  }

  const candidates = [
    path.join(cwd, 'ios', 'App', 'App', 'Info.plist'),
    path.join(cwd, 'ios', 'App', 'Info.plist'),
  ]

  for (const candidate of candidates) {
    const contents = await readTextFileIfExists(candidate)

    if (!contents) {
      continue
    }

    const version = extractIosPlistString(contents, 'CFBundleShortVersionString')

    if (version) {
      return resolveIosVersionValue(cwd, version)
    }
  }

  throw new Error('Unable to resolve iOS runtime version. Pass --runtime-version or ensure Info.plist defines CFBundleShortVersionString.')
}

export async function resolveAndroidRuntimeVersion(cwd: string, runtimeVersion?: string) {
  if (runtimeVersion) {
    return runtimeVersion
  }

  const candidates = [
    path.join(cwd, 'android', 'app', 'build.gradle'),
    path.join(cwd, 'android', 'app', 'build.gradle.kts'),
  ]

  for (const candidate of candidates) {
    const contents = await readTextFileIfExists(candidate)

    if (!contents) {
      continue
    }

    const match = contents.match(/versionName\s*(?:=)?\s*["']([^"']+)["']/)

    if (match?.[1]) {
      return match[1].trim()
    }
  }

  throw new Error('Unable to resolve Android runtime version. Pass --runtime-version or ensure build.gradle defines versionName as a string literal.')
}

export async function resolveCapacitorRuntimeVersion(
  cwd: string,
  platform: MobilePlatform,
  runtimeVersion?: string,
) {
  if (platform === 'ios') {
    return resolveIosRuntimeVersion(cwd, runtimeVersion)
  }

  return resolveAndroidRuntimeVersion(cwd, runtimeVersion)
}

export async function resolveProjectRuntimeVersion(
  cwd: string,
  platform: MobilePlatform,
  runtimeVersion?: string,
) {
  if (runtimeVersion) {
    return runtimeVersion
  }

  const runtimeResolver = platform === 'ios'
    ? resolveIosRuntimeVersion
    : resolveAndroidRuntimeVersion
  const nativeRuntimeVersion = await runtimeResolver(cwd).catch(() => null)

  if (nativeRuntimeVersion) {
    return nativeRuntimeVersion
  }

  const expoConfig = await readExpoConfig(cwd).catch(() => null)

  if (expoConfig) {
    const expoRuntimeVersion = resolveExpoRuntimeVersion(
      expoConfig,
      platform,
      undefined,
      undefined,
      resolveExpoConfiguredVersion(expoConfig, platform),
    )

    if (expoRuntimeVersion) {
      return expoRuntimeVersion
    }
  }

  throw new Error(`Unable to resolve ${platform} runtime version. Pass --runtime-version to override.`)
}
