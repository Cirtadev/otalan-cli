import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, test } from 'bun:test'
import { unzipSync } from 'fflate'

import { bundleProject, bundleTestUtils } from '../src/bundle'

// -----------------------------------------------------------------------------
// bundle IDs
// -----------------------------------------------------------------------------

describe('bundleTestUtils.normalizeBundleId', () => {
  test('normalizes non URL-safe characters into hyphens', () => {
    expect(bundleTestUtils.normalizeBundleId('  release 1/ios  ')).toBe('release-1-ios')
  })

  test('falls back to "bundle" when the seed contains no valid characters', () => {
    expect(bundleTestUtils.normalizeBundleId('***')).toBe('bundle')
  })
})

describe('bundleTestUtils.resolveBundleId', () => {
  test('prefers an explicit bundle ID', () => {
    expect(bundleTestUtils.resolveBundleId({
      bundleId: '  1.0.5 beta ',
      explicitBundleIdSource: 'flag',
      bundleFromPackage: true,
      packageVersion: '2.0.0',
      nativeVersion: '3.0.0',
      hash: 'abcdef1234567890',
    })).toEqual({
      bundleId: '1.0.5-beta',
      bundleIdSource: 'flag',
    })
  })

  test('tracks bundle IDs entered through the interactive prompt', () => {
    expect(bundleTestUtils.resolveBundleId({
      bundleId: '  1.0.5 beta ',
      explicitBundleIdSource: 'prompt',
      nativeVersion: '3.0.0',
      hash: 'abcdef1234567890',
    })).toEqual({
      bundleId: '1.0.5-beta',
      bundleIdSource: 'prompt',
    })
  })

  test('uses package.json when requested', () => {
    expect(bundleTestUtils.resolveBundleId({
      bundleFromPackage: true,
      packageVersion: '2.0.0',
      nativeVersion: '3.0.0',
      hash: 'abcdef1234567890',
    })).toEqual({
      bundleId: '2.0.0',
      bundleIdSource: 'package-json',
    })
  })

  test('generates an auto bundle ID from nativeVersion and hash by default', () => {
    expect(bundleTestUtils.resolveBundleId({
      nativeVersion: '3.0.0',
      hash: 'abcdef1234567890',
    })).toEqual({
      bundleId: '3.0.0-abcdef123456',
      bundleIdSource: 'native-version',
    })
  })
})

describe('bundleTestUtils.collectDirectoryEntries', () => {
  test('collects entries in deterministic path order', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'otalan-bundle-test-'))

    try {
      await mkdir(path.join(rootDir, 'nested'))
      await Bun.write(path.join(rootDir, 'z.txt'), 'z')
      await Bun.write(path.join(rootDir, 'a.txt'), 'a')
      await Bun.write(path.join(rootDir, 'nested', 'b.txt'), 'b')

      const entries = await bundleTestUtils.collectDirectoryEntries(rootDir)

      expect(Object.keys(entries)).toEqual([
        'a.txt',
        'nested/b.txt',
        'z.txt',
      ])
    } finally {
      await rm(rootDir, { recursive: true, force: true })
    }
  })
})

describe('bundleTestUtils.zipDirectory', () => {
  test('omits source maps from bundle ZIP entries and reports the count', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'otalan-bundle-test-'))

    try {
      await mkdir(path.join(rootDir, 'nested'))
      await Bun.write(path.join(rootDir, 'index.js'), 'console.log("ok")')
      await Bun.write(path.join(rootDir, 'index.js.map'), '{}')
      await Bun.write(path.join(rootDir, 'nested', 'chunk.js'), 'console.log("chunk")')
      await Bun.write(path.join(rootDir, 'nested', 'chunk.js.map'), '{}')

      const bundleArchive = await bundleTestUtils.zipDirectory(rootDir)
      const zipEntries = unzipSync(bundleArchive.bytes)

      expect(Object.keys(zipEntries).sort()).toEqual([
        'index.js',
        'nested/chunk.js',
      ])
      expect(bundleArchive.omittedSourceMapCount).toBe(2)
    } finally {
      await rm(rootDir, { recursive: true, force: true })
    }
  })
})

describe('bundleProject', () => {
  test('omits Capacitor source maps from the generated bundle ZIP', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'otalan-capacitor-project-'))
    const outputDir = path.join(rootDir, '.otalan', 'bundle')

    try {
      await mkdir(path.join(rootDir, 'dist', 'assets'), { recursive: true })
      await Bun.write(path.join(rootDir, 'dist', 'index.html'), '<script src="assets/app.js"></script>')
      await Bun.write(path.join(rootDir, 'dist', 'assets', 'app.js'), 'console.log("app")')
      await Bun.write(path.join(rootDir, 'dist', 'assets', 'app.js.map'), '{}')

      const result = await bundleProject({
        cwd: rootDir,
        outputDir,
        nativeVersion: '1.0.0',
        platform: 'ios',
        target: 'capacitor',
      })
      const zipBytes = new Uint8Array(await Bun.file(path.join(outputDir, 'bundle.zip')).arrayBuffer())
      const zipEntries = unzipSync(zipBytes)

      expect(Object.keys(zipEntries).sort()).toEqual([
        'assets/app.js',
        'index.html',
      ])
      expect(result.omittedSourceMapCount).toBe(1)
    } finally {
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  test('omits Expo source maps from the generated bundle ZIP', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'otalan-expo-project-'))
    const outputDir = path.join(rootDir, '.otalan', 'bundle')
    const originalSpawn = Bun.spawn
    const bunWithSpawn = Bun as typeof Bun & {
      spawn: typeof Bun.spawn
    }

    try {
      bunWithSpawn.spawn = ((command: string[]) => {
        const outputDirIndex = command.indexOf('--output-dir')

        if (
          command[0] === 'bunx'
          && command[1] === 'expo'
          && command[2] === 'export'
          && outputDirIndex !== -1
        ) {
          const exportDir = command[outputDirIndex + 1]

          return {
            exited: (async () => {
              await mkdir(path.join(exportDir, '_expo', 'static', 'js', 'ios'), { recursive: true })
              await mkdir(path.join(exportDir, 'assets'), { recursive: true })
              await Bun.write(path.join(exportDir, '_expo', 'static', 'js', 'ios', 'entry.js'), 'console.log("expo")')
              await Bun.write(path.join(exportDir, '_expo', 'static', 'js', 'ios', 'entry.js.map'), '{}')
              await Bun.write(path.join(exportDir, 'assets', 'icon.png'), 'png')

              return 0
            })(),
          } as unknown as ReturnType<typeof Bun.spawn>
        }

        if (
          command[0] === 'bunx'
          && command[1] === 'expo'
          && command[2] === 'config'
          && command[3] === '--json'
        ) {
          return {
            exited: Promise.resolve(0),
            stdout: new Blob([JSON.stringify({
              expo: {
                version: '1.0.0',
                runtimeVersion: '1.0.0',
              },
            })]),
          } as unknown as ReturnType<typeof Bun.spawn>
        }

        throw new Error(`Unexpected spawn command: ${command.join(' ')}`)
      }) as typeof Bun.spawn

      const result = await bundleProject({
        cwd: rootDir,
        outputDir,
        platform: 'ios',
        target: 'expo',
      })
      const zipBytes = new Uint8Array(await Bun.file(path.join(outputDir, 'bundle.zip')).arrayBuffer())
      const zipEntries = unzipSync(zipBytes)

      expect(Object.keys(zipEntries).sort()).toEqual([
        '_expo/static/js/ios/entry.js',
        'assets/icon.png',
      ])
      expect(result.manifest.target).toBe('expo')
      expect(result.omittedSourceMapCount).toBe(1)
    } finally {
      bunWithSpawn.spawn = originalSpawn
      await rm(rootDir, { recursive: true, force: true })
    }
  })
})

// -----------------------------------------------------------------------------
// Expo helpers
// -----------------------------------------------------------------------------

describe('bundleTestUtils.resolveExpoNativeVersion', () => {
  test('prefers an explicit native version override', () => {
    expect(bundleTestUtils.resolveExpoNativeVersion({
      version: '1.0.0',
      ios: {
        version: '1.0.1',
      },
    }, 'ios', '9.9.9')).toBe('9.9.9')
  })

  test('uses platform-specific values before falling back to top-level version', () => {
    expect(bundleTestUtils.resolveExpoNativeVersion({
      version: '1.0.0',
      ios: {
        version: '1.0.1',
      },
    }, 'ios')).toBe('1.0.1')

    expect(bundleTestUtils.resolveExpoNativeVersion({
      version: '1.0.0',
    }, 'android')).toBe('1.0.0')
  })
})

describe('bundleTestUtils.resolveExpoRuntimeVersion', () => {
  test('prefers an explicit runtimeVersion override', () => {
    expect(bundleTestUtils.resolveExpoRuntimeVersion({
      runtimeVersion: '1.0.0',
    }, 'ios', '9.9.9', undefined)).toBe('9.9.9')
  })

  test('uses the exported runtimeVersion when present', () => {
    expect(bundleTestUtils.resolveExpoRuntimeVersion({
      runtimeVersion: '1.0.0',
    }, 'ios', undefined, '2.0.0')).toBe('2.0.0')
  })

  test('falls back to the native version when Expo has no runtimeVersion', () => {
    expect(bundleTestUtils.resolveExpoRuntimeVersion({
      version: '1.0.0',
    }, 'ios', undefined, undefined, '1.0.0')).toBe('1.0.0')
  })

  test('resolves runtimeVersion policies from Expo config', () => {
    expect(bundleTestUtils.resolveExpoRuntimeVersion({
      version: '1.2.3',
      runtimeVersion: {
        policy: 'appVersion',
      },
    }, 'ios')).toBe('1.2.3')

    expect(bundleTestUtils.resolveExpoRuntimeVersion({
      sdkVersion: '52.0.0',
      runtimeVersion: {
        policy: 'sdkVersion',
      },
    }, 'android')).toBe('exposdk:52.0.0')

    expect(bundleTestUtils.resolveExpoRuntimeVersion({
      version: '1.2.3',
      ios: {
        buildNumber: '45',
        runtimeVersion: {
          policy: 'nativeVersion',
        },
      },
    }, 'ios')).toBe('1.2.3(45)')
  })
})

describe('bundleTestUtils.findRuntimeVersionInObject', () => {
  test('recursively finds the first nested runtimeVersion string', () => {
    expect(bundleTestUtils.findRuntimeVersionInObject({
      metadata: {
        nested: [
          {
            runtimeVersion: '3.4.5',
          },
        ],
      },
    })).toBe('3.4.5')
  })
})

describe('bundleTestUtils.createExpoExportDirectory', () => {
  test('creates Expo export directories inside the project', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'otalan-expo-project-'))

    try {
      const exportDir = await bundleTestUtils.createExpoExportDirectory(rootDir)

      expect(exportDir.startsWith(path.join(rootDir, '.otalan', 'expo-export-'))).toBe(true)
    } finally {
      await rm(rootDir, { recursive: true, force: true })
    }
  })
})
