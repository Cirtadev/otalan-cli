import path from 'node:path'

import { describe, expect, test } from 'bun:test'

import { stripAnsi } from './helpers/ansi'

const PROJECT_ROOT = path.resolve(import.meta.dir, '..')

async function runCli(args: string[], options: { env?: Record<string, string> } = {}) {
  const proc = Bun.spawn(['bun', './src/bin.ts', ...args], {
    cwd: PROJECT_ROOT,
    ...(options.env ? { env: { ...process.env, ...options.env }} : {}),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  return {
    stdout,
    stderr,
    exitCode,
  }
}

async function readPackageVersion() {
  const packageJson = await Bun.file(path.join(PROJECT_ROOT, 'package.json')).json() as { version?: unknown }

  if (typeof packageJson.version !== 'string') {
    throw new Error('package.json version must be a string.')
  }

  return packageJson.version
}

describe('CLI help', () => {
  test('help reflects the release workflow', async () => {
    const result = await runCli(['help'])
    const version = await readPackageVersion()
    const stdout = stripAnsi(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(stdout).toContain(`Otalan CLI ${version}`)
    expect(stdout).toContain('version')
    expect(stdout).toContain('Show CLI version.')
    expect(stdout).toContain('doctor')
    expect(stdout).toContain('Check API connectivity and OTA Publish Key context.')
    expect(stdout).toContain('keygen')
    expect(stdout).toContain('Generate an Otalan key locally without calling the API.')
    expect(stdout).toContain('Publish the current bundle ZIP with rollout metadata.')
    expect(stdout).toContain('List release channels for the authenticated project.')
    expect(stdout).toContain('Pause the active bundle rollout.')
    expect(stdout).toContain('Resume the active bundle rollout.')
    expect(stdout).toContain('Official app support: Capacitor 7/8 and Expo SDK 54/55/56.')
    expect(stdout).toContain('App-scoped release commands require the configured app to be active, not archived.')
    expect(stdout).not.toContain('upload')
    expect(stdout).not.toContain('--storage-key')
    expect(stdout).not.toContain('--download-url')
    expect(result.stderr).toBe('')
  })

  test('no command prints help with the package version', async () => {
    const result = await runCli([])
    const stdout = stripAnsi(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(stdout).toContain(`Otalan CLI ${await readPackageVersion()}`)
    expect(stdout).toContain('Usage: otalan <command> [options]')
    expect(stdout).toContain('Notes:')
    expect(stdout).toContain('Run `otalan login` to authenticate to a project; `otalan init` selects an active app in that project.')
    expect(stdout).toContain('Otalan validates release ZIPs before `otalan publish` succeeds.')
    expect(stdout).toContain('App-scoped release commands require the configured app to be active, not archived.')
    expect(stdout).toContain('Run `otalan <command> --help` to show this help text.')
    expect(stdout).not.toContain('Capacitor packages prebuilt web assets')
    expect(stdout).not.toContain('Expo runs `bunx expo export`')
    expect(stdout).not.toContain('Expo runtimeVersion comes from')
    expect(stdout).not.toContain('Use an OTA Publish Key with the CLI.')
    expect(stdout).not.toContain('Get OTA Publish Keys from https://otalan.com/api-keys.')
    expect(stdout).not.toContain('Release commands print the resolved organization and project before continuing.')
    expect(result.stderr).toBe('')
  })

  test('upload is rejected as an unknown command', async () => {
    const result = await runCli(['upload'])

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(stripAnsi(result.stderr)).toContain('Unknown command: upload')
  })

  test('debug mode prints stack traces for command errors', async () => {
    const result = await runCli(['upload'], {
      env: {
        OTALAN_DEBUG: '1',
      },
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Error: Unknown command: upload')
    expect(result.stderr).toContain('at main')
  })

  test('login --help prints help text without triggering login prompts', async () => {
    const result = await runCli(['login', '--help'])
    const stdout = stripAnsi(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(stdout).toContain(`Otalan CLI ${await readPackageVersion()}`)
    expect(stdout).toContain('Usage: otalan <command> [options]')
    expect(stdout).not.toContain('Otalan API URL (')
    expect(stdout).not.toContain('Get your OTA Publish Key from:')
    expect(stdout).not.toContain('OTA Publish Key:')
    expect(result.stderr).toBe('')
  })

  test('login -h prints help text without triggering login prompts', async () => {
    const result = await runCli(['login', '-h'])
    const stdout = stripAnsi(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(stdout).toContain(`Otalan CLI ${await readPackageVersion()}`)
    expect(stdout).toContain('Usage: otalan <command> [options]')
    expect(stdout).not.toContain('OTA Publish Key:')
    expect(result.stderr).toBe('')
  })

  test('init --help prints help text without triggering init prompts', async () => {
    const result = await runCli(['init', '--help'])
    const stdout = stripAnsi(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(stdout).toContain(`Otalan CLI ${await readPackageVersion()}`)
    expect(stdout).toContain('Usage: otalan <command> [options]')
    expect(stdout).not.toContain('App ID:')
    expect(result.stderr).toBe('')
  })
})

describe('CLI keygen', () => {
  test('generates an OTA Publish Key and prints the suffix separately', async () => {
    const result = await runCli(['keygen', '--kind', 'ci'])
    const stdout = stripAnsi(result.stdout)
    const fullKey = stdout.match(/otalan_ci_[A-Za-z0-9_-]{32}/)?.[0]
    const suffix = stdout.match(/Without prefix │ ([A-Za-z0-9_-]{32})/)?.[1]

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(stdout.trim().split('\n').at(0)).toBe('✓ Generated OTA Publish Key')
    expect(fullKey).toMatch(/^otalan_ci_[A-Za-z0-9_-]{32}$/)
    expect(suffix).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(fullKey).toBe(`otalan_ci_${suffix}`)
  })

  test('generates an OTA App Key and prints the suffix separately', async () => {
    const result = await runCli(['keygen', '--kind', 'ota'])
    const stdout = stripAnsi(result.stdout)
    const fullKey = stdout.match(/otalan_ota_[A-Za-z0-9_-]{32}/)?.[0]
    const suffix = stdout.match(/Without prefix │ ([A-Za-z0-9_-]{32})/)?.[1]

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(stdout.trim().split('\n').at(0)).toBe('✓ Generated OTA App Key')
    expect(fullKey).toMatch(/^otalan_ota_[A-Za-z0-9_-]{32}$/)
    expect(suffix).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(fullKey).toBe(`otalan_ota_${suffix}`)
  })

  test('rejects invalid key kinds', async () => {
    const result = await runCli(['keygen', '--kind', 'admin'])

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(stripAnsi(result.stderr)).toContain('Key kind is required. Use --kind ci or --kind ota.')
  })
})

describe('CLI version', () => {
  test.each([
    ['version'],
    ['--version'],
    ['-v'],
  ])('%s prints the package version', async (command) => {
    const result = await runCli([command])

    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe(await readPackageVersion())
    expect(result.stderr).toBe('')
  })
})
