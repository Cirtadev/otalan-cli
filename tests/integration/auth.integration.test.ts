import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { authCommandTestUtils } from '../../src/commands/auth'
import { saveGlobalConfig } from '../../src/config'

// -----------------------------------------------------------------------------
// Test setup
// -----------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(import.meta.dir, '..', '..')
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map(tempDir => rm(tempDir, {
    force: true,
    recursive: true,
  })))
  tempDirs.length = 0
})

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

async function runCli(args: string[], env: NodeJS.ProcessEnv) {
  const proc = Bun.spawn(['bun', './src/bin.ts', ...args], {
    cwd: PROJECT_ROOT,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const result = Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).then(([stdout, stderr, exitCode]) => ({
    stdout,
    stderr,
    exitCode,
  }))
  const timeout = Bun.sleep(3_000).then(() => {
    proc.kill()
    throw new Error(`CLI timed out: otalan ${args.join(' ')}`)
  })

  return Promise.race([result, timeout])
}

// -----------------------------------------------------------------------------
// Auth integration
// -----------------------------------------------------------------------------

describe('login integration', () => {
  test('persists auth after successful validation', async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), 'otalan-cli-home-'))
    const configPath = path.join(homeDir, '.otalan', 'config.json')

    tempDirs.push(homeDir)

    await authCommandTestUtils.validateAndSaveLogin({
      apiUrl: 'https://api.otalan.com',
      apiKey: 'test-key',
      loadContext: async input => {
        expect(input).toEqual({
          apiUrl: 'https://api.otalan.com',
          apiKey: 'test-key',
        })

        return {
          organizationId: 'org-123',
          organizationName: 'Test Org',
          organizationSlug: 'test-org',
          projectId: 'project-123',
          projectName: 'Test Project',
          projectSlug: 'test-project',
        }
      },
      saveConfig: config => saveGlobalConfig(config, {
        homeDir,
      }),
    })

    await expect(Bun.file(configPath).json()).resolves.toEqual({
      apiKey: 'test-key',
      apiUrl: 'https://api.otalan.com',
    })
  })

  test('does not overwrite saved auth when login validation fails', async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), 'otalan-cli-home-'))
    const configDir = path.join(homeDir, '.otalan')
    const configPath = path.join(configDir, 'config.json')
    const apiUrl = 'http://127.0.0.1:1'

    tempDirs.push(homeDir)

    await mkdir(configDir, { recursive: true })
    await writeFile(configPath, `${JSON.stringify({
      apiKey: 'stored-key',
      apiUrl,
    }, null, 2)}\n`)

    const result = await runCli(['login', '--api-key', 'test-key'], {
      ...process.env,
      HOME: homeDir,
    })
    const savedConfig = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>

    expect(result.exitCode).toBe(1)
    expect(result.stdout).not.toContain('Saved CLI auth.')
    expect(result.stdout).not.toContain('Otalan API URL')
    expect(savedConfig).toEqual({
      apiKey: 'stored-key',
      apiUrl,
    })
  })
})
