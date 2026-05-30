import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, test } from 'bun:test'

import { bundleProject, bundleTestUtils } from '../src/bundle'

type SpawnOptions = {
  stderr?: unknown
  stdin?: unknown
  stdout?: unknown
}

async function createLocalExpoCli(cwd: string) {
  await mkdir(path.join(cwd, 'node_modules', 'expo'), { recursive: true })
  await Bun.write(path.join(cwd, 'node_modules', 'expo', 'package.json'), '{"name":"expo"}\n')
}

async function bundleExpoWithSpawnCalls(verbose?: boolean) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'otalan-expo-project-'))
  const originalSpawn = Bun.spawn
  const calls: Array<{ command: string[], options?: SpawnOptions }> = []
  const bunWithSpawn = Bun as typeof Bun & {
    spawn: typeof Bun.spawn
  }

  try {
    await createLocalExpoCli(rootDir)

    bunWithSpawn.spawn = ((command: string[], options?: SpawnOptions) => {
      calls.push({ command, options })

      if (command[0] === 'bunx' && command[1] === 'expo' && command[2] === 'export') {
        const outputDirIndex = command.indexOf('--output-dir')
        const exportDir = command[outputDirIndex + 1]

        return {
          exited: (async () => {
            await mkdir(path.join(exportDir, '_expo', 'static', 'js', 'ios'), { recursive: true })
            await Bun.write(path.join(exportDir, '_expo', 'static', 'js', 'ios', 'entry.js'), 'console.log("expo")')

            return 0
          })(),
          stderr: new Blob(['hidden export stderr']),
          stdout: new Blob(['hidden export stdout']),
        } as unknown as ReturnType<typeof Bun.spawn>
      }

      if (command[0] === 'bunx' && command[1] === 'expo' && command[2] === 'config') {
        return {
          exited: Promise.resolve(0),
          stderr: new Blob(['hidden config stderr']),
          stdout: new Blob([JSON.stringify({
            expo: {
              runtimeVersion: '1.0.0',
              version: '1.0.0',
            },
          })]),
        } as unknown as ReturnType<typeof Bun.spawn>
      }

      throw new Error(`Unexpected spawn command: ${command.join(' ')}`)
    }) as typeof Bun.spawn

    await bundleProject({
      cwd: rootDir,
      outputDir: path.join(rootDir, '.otalan', 'bundle'),
      platform: 'ios',
      target: 'expo',
      verbose,
    })

    return calls
  } finally {
    bunWithSpawn.spawn = originalSpawn
    await rm(rootDir, { recursive: true, force: true })
  }
}

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

  test('captures Expo subprocess output by default', async () => {
    const calls = await bundleExpoWithSpawnCalls()
    const exportCall = calls.find(call => call.command.includes('export'))
    const configCall = calls.find(call => call.command.includes('config'))

    expect(exportCall?.options).toMatchObject({
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(configCall?.options).toMatchObject({
      stdout: 'pipe',
      stderr: 'pipe',
    })
  })

  test('streams Expo subprocess output when verbose is set', async () => {
    const calls = await bundleExpoWithSpawnCalls(true)
    const exportCall = calls.find(call => call.command.includes('export'))
    const configCall = calls.find(call => call.command.includes('config'))

    expect(exportCall?.options).toMatchObject({
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    })
    expect(configCall?.options).toMatchObject({
      stdout: 'pipe',
      stderr: 'inherit',
    })
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
