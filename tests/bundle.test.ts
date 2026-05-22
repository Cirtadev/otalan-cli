import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, test } from 'bun:test'
import { unzipSync } from 'fflate'

import { bundleProject, bundleTestUtils } from '../src/bundle'

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

async function createLocalExpoCli(cwd: string) {
  await mkdir(path.join(cwd, 'node_modules', 'expo'), { recursive: true })
  await Bun.write(path.join(cwd, 'node_modules', 'expo', 'package.json'), '{"name":"expo"}\n')
}

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

describe('bundleTestUtils.createBundleArchiveFileName', () => {
  test('adds the normalized bundle ID before the ZIP extension', () => {
    expect(bundleTestUtils.createBundleArchiveFileName('  release 1/ios  ')).toBe('bundle-release-1-ios.zip')
  })

  test('removes path separators and other unsafe filename characters', () => {
    expect(bundleTestUtils.createBundleArchiveFileName('../release @ ios:beta')).toBe('bundle-..-release-ios-beta.zip')
  })

  test('uses the bundle fallback for archive names with no safe bundle ID characters', () => {
    expect(bundleTestUtils.createBundleArchiveFileName('***')).toBe('bundle-bundle.zip')
  })
})

describe('bundleTestUtils.resolveBundleId', () => {
  test('prefers an explicit bundle ID', () => {
    expect(bundleTestUtils.resolveBundleId({
      bundleId: '  1.0.5 beta ',
      explicitBundleIdSource: 'flag',
      bundleFromPackage: true,
      packageVersion: '2.0.0',
      runtimeVersion: '3.0.0',
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
      runtimeVersion: '3.0.0',
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
      runtimeVersion: '3.0.0',
      hash: 'abcdef1234567890',
    })).toEqual({
      bundleId: '2.0.0',
      bundleIdSource: 'package-json',
    })
  })

  test('generates an auto bundle ID from runtimeVersion and hash by default', () => {
    expect(bundleTestUtils.resolveBundleId({
      runtimeVersion: '3.0.0',
      hash: 'abcdef1234567890',
    })).toEqual({
      bundleId: '3.0.0-abcdef123456',
      bundleIdSource: 'runtime-version',
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

  test('rejects native project files before generating a bundle ZIP', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'otalan-bundle-test-'))

    try {
      await mkdir(path.join(rootDir, 'android', 'app'), { recursive: true })
      await mkdir(path.join(rootDir, 'assets'), { recursive: true })
      await Bun.write(path.join(rootDir, 'index.html'), '<script src="assets/app.js"></script>')
      await Bun.write(path.join(rootDir, 'assets', 'app.js'), 'console.log("ok")')
      await Bun.write(path.join(rootDir, 'android', 'app', 'build.gradle'), 'android {}')

      await expect(bundleTestUtils.zipDirectory(rootDir)).rejects.toThrow(
        'Native project files were found in bundle input',
      )
    } finally {
      await rm(rootDir, { recursive: true, force: true })
    }
  })
})

describe('bundleTestUtils.findNativeBundleEntries', () => {
  test('detects native bundle entries without flagging Expo platform folders', () => {
    expect(bundleTestUtils.findNativeBundleEntries([
      '_expo/static/js/ios/entry.js',
      'assets/icon.png',
    ])).toEqual([])

    expect(bundleTestUtils.findNativeBundleEntries([
      'android/app/build.gradle',
      'assets/app.js',
      'ios/App/AppDelegate.swift',
      'plugins/MyPlugin.xcodeproj/project.pbxproj',
    ])).toEqual([
      {
        path: 'android/app/build.gradle',
        reason: 'native platform directory',
      },
      {
        path: 'ios/App/AppDelegate.swift',
        reason: 'native platform directory',
      },
      {
        path: 'plugins/MyPlugin.xcodeproj/project.pbxproj',
        reason: 'native project directory',
      },
    ])
  })
})

describe('bundleProject', () => {
  test('omits Capacitor source maps from the generated bundle ZIP', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'otalan-capacitor-project-'))
    const outputDir = path.join(rootDir, '.otalan', 'bundle')

    try {
      await mkdir(path.join(rootDir, 'dist', 'assets'), { recursive: true })
      await mkdir(outputDir, { recursive: true })
      await Bun.write(path.join(rootDir, 'dist', 'index.html'), '<script src="assets/app.js"></script>')
      await Bun.write(path.join(rootDir, 'dist', 'assets', 'app.js'), 'console.log("app")')
      await Bun.write(path.join(rootDir, 'dist', 'assets', 'app.js.map'), '{}')
      await Bun.write(path.join(outputDir, 'bundle.zip'), 'stale zip')

      const result = await bundleProject({
        cwd: rootDir,
        outputDir,
        runtimeVersion: '1.0.0',
        platform: 'ios',
        target: 'capacitor',
      })
      const zipBytes = new Uint8Array(await Bun.file(path.join(outputDir, result.archiveFileName)).arrayBuffer())
      const zipEntries = unzipSync(zipBytes)

      expect(result.archiveFileName).toBe(`bundle-${result.manifest.bundleId}.zip`)
      expect(await Bun.file(path.join(outputDir, 'bundle.zip')).exists()).toBe(false)
      expect(Object.keys(zipEntries).sort()).toEqual([
        'assets/app.js',
        'index.html',
      ])
      expect(result.omittedSourceMapCount).toBe(1)
    } finally {
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  test('runs the manifest validation hook before writing bundle output', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'otalan-capacitor-project-'))
    const outputDir = path.join(rootDir, '.otalan', 'bundle')

    try {
      await mkdir(path.join(rootDir, 'dist'), { recursive: true })
      await Bun.write(path.join(rootDir, 'dist', 'index.html'), '<script src="app.js"></script>')
      await Bun.write(path.join(rootDir, 'dist', 'app.js'), 'console.log("app")')

      await expect(bundleProject({
        cwd: rootDir,
        outputDir,
        runtimeVersion: '1.0.0',
        platform: 'ios',
        target: 'capacitor',
        beforeWrite: async manifest => {
          expect(manifest.bundleId.startsWith('1.0.0-')).toBe(true)
          throw new Error('Bundle ID already exists.')
        },
      })).rejects.toThrow('Bundle ID already exists.')

      expect(await Bun.file(path.join(outputDir, 'bundle.zip')).exists()).toBe(false)
      expect(await Bun.file(path.join(outputDir, 'manifest.json')).exists()).toBe(false)
    } finally {
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  test('uses the normalized explicit bundle ID in the archive file name', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'otalan-capacitor-project-'))
    const outputDir = path.join(rootDir, '.otalan', 'bundle')

    try {
      await mkdir(path.join(rootDir, 'dist'), { recursive: true })
      await Bun.write(path.join(rootDir, 'dist', 'index.html'), '<script src="app.js"></script>')
      await Bun.write(path.join(rootDir, 'dist', 'app.js'), 'console.log("app")')

      const result = await bundleProject({
        cwd: rootDir,
        outputDir,
        bundleId: ' release @ ios:beta ',
        explicitBundleIdSource: 'flag',
        runtimeVersion: '1.0.0',
        platform: 'ios',
        target: 'capacitor',
      })

      expect(result.manifest.bundleId).toBe('release-ios-beta')
      expect(result.archiveFileName).toBe('bundle-release-ios-beta.zip')
      expect(await Bun.file(path.join(outputDir, result.archiveFileName)).exists()).toBe(true)
    } finally {
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  test('rejects Capacitor bundle input that contains native project files', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'otalan-capacitor-project-'))
    const outputDir = path.join(rootDir, '.otalan', 'bundle')

    try {
      await mkdir(path.join(rootDir, 'dist', 'android', 'app'), { recursive: true })
      await Bun.write(path.join(rootDir, 'dist', 'index.html'), '<script src="app.js"></script>')
      await Bun.write(path.join(rootDir, 'dist', 'app.js'), 'console.log("app")')
      await Bun.write(path.join(rootDir, 'dist', 'android', 'app', 'build.gradle'), 'android {}')

      await expect(bundleProject({
        cwd: rootDir,
        outputDir,
        runtimeVersion: '1.0.0',
        platform: 'android',
        target: 'capacitor',
      })).rejects.toThrow('Native project files were found in bundle input')

      expect(await Bun.file(path.join(outputDir, 'bundle.zip')).exists()).toBe(false)
      expect(await Bun.file(path.join(outputDir, 'manifest.json')).exists()).toBe(false)
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
      await createLocalExpoCli(rootDir)

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
      const zipBytes = new Uint8Array(await Bun.file(path.join(outputDir, result.archiveFileName)).arrayBuffer())
      const zipEntries = unzipSync(zipBytes)

      expect(result.archiveFileName).toBe(`bundle-${result.manifest.bundleId}.zip`)
      expect(await Bun.file(path.join(outputDir, 'bundle.zip')).exists()).toBe(false)
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

  test('rejects Expo export output that contains native project files', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'otalan-expo-project-'))
    const outputDir = path.join(rootDir, '.otalan', 'bundle')
    const originalSpawn = Bun.spawn
    const bunWithSpawn = Bun as typeof Bun & {
      spawn: typeof Bun.spawn
    }

    try {
      await createLocalExpoCli(rootDir)

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
              await mkdir(path.join(exportDir, 'ios', 'App'), { recursive: true })
              await Bun.write(path.join(exportDir, '_expo', 'static', 'js', 'ios', 'entry.js'), 'console.log("expo")')
              await Bun.write(path.join(exportDir, 'ios', 'App', 'AppDelegate.swift'), 'import UIKit')

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

      await expect(bundleProject({
        cwd: rootDir,
        outputDir,
        platform: 'ios',
        target: 'expo',
      })).rejects.toThrow('Native project files were found in bundle input')

      expect(await Bun.file(path.join(outputDir, 'bundle.zip')).exists()).toBe(false)
      expect(await Bun.file(path.join(outputDir, 'manifest.json')).exists()).toBe(false)
    } finally {
      bunWithSpawn.spawn = originalSpawn
      await rm(rootDir, { recursive: true, force: true })
    }
  })
})

// -----------------------------------------------------------------------------
// Expo helpers
// -----------------------------------------------------------------------------

describe('bundleTestUtils.resolveExpoRuntimeVersion', () => {
  test('prefers an explicit runtime version override', () => {
    expect(bundleTestUtils.resolveExpoRuntimeVersion({
      version: '1.0.0',
      ios: {
        version: '1.0.1',
      },
    }, 'ios', '9.9.9')).toBe('9.9.9')
  })

  test('uses the fallback runtime version when Expo has no runtimeVersion', () => {
    expect(bundleTestUtils.resolveExpoRuntimeVersion({
      version: '1.0.0',
      ios: {
        version: '1.0.1',
      },
    }, 'ios', undefined, undefined, '1.0.1')).toBe('1.0.1')

    expect(bundleTestUtils.resolveExpoRuntimeVersion({
      version: '1.0.0',
    }, 'android', undefined, undefined, '1.0.0')).toBe('1.0.0')
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

  test('falls back to the runtime version when Expo has no runtimeVersion', () => {
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

    expect(() => bundleTestUtils.resolveExpoRuntimeVersion({
      runtimeVersion: {
        policy: 'runtimeVersion',
      },
    }, 'ios')).toThrow(
      'Unable to resolve Expo runtimeVersion policy "runtimeVersion". Pass --runtime-version or use a resolved Expo runtimeVersion.',
    )
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

  test('stops before deeply nested metadata can exhaust the stack', () => {
    let value: Record<string, unknown> = {
      runtimeVersion: 'too-deep',
    }

    for (let index = 0; index < 40; index += 1) {
      value = {
        nested: value,
      }
    }

    expect(bundleTestUtils.findRuntimeVersionInObject(value)).toBeUndefined()
  })
})

describe('bundleProject Expo CLI validation', () => {
  test('requires a local Expo CLI package before running bunx expo', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'otalan-expo-project-'))

    try {
      await expect(bundleProject({
        cwd: rootDir,
        outputDir: path.join(rootDir, '.otalan', 'bundle'),
        platform: 'ios',
        target: 'expo',
      })).rejects.toThrow('Expo CLI is required for Expo bundles.')
    } finally {
      await rm(rootDir, { recursive: true, force: true })
    }
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
