import path from 'node:path'

import { describe, expect, test } from 'bun:test'

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(import.meta.dir, '..')

// -----------------------------------------------------------------------------
// CLI help
// -----------------------------------------------------------------------------

async function runCli(args: string[]) {
  const proc = Bun.spawn(['bun', './src/bin.ts', ...args], {
    cwd: PROJECT_ROOT,
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

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(`Otalan CLI ${version}`)
    expect(result.stdout).toContain('version')
    expect(result.stdout).toContain('Show CLI version.')
    expect(result.stdout).toContain('doctor')
    expect(result.stdout).toContain('Check API connectivity and OTA Publish Key context.')
    expect(result.stdout).toContain('keygen')
    expect(result.stdout).toContain('Generate an Otalan key locally without calling the API.')
    expect(result.stdout).toContain('Publish the current bundle ZIP with rollout metadata.')
    expect(result.stdout).toContain('Pause the active bundle rollout.')
    expect(result.stdout).toContain('Resume the active bundle rollout.')
    expect(result.stdout).toContain('Release commands require the configured app to be active, not archived.')
    expect(result.stdout).not.toContain('upload')
    expect(result.stdout).not.toContain('--storage-key')
    expect(result.stdout).not.toContain('--download-url')
    expect(result.stderr).toBe('')
  })

  test('no command prints help with the package version', async () => {
    const result = await runCli([])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(`Otalan CLI ${await readPackageVersion()}`)
    expect(result.stdout).toContain('Usage: otalan <command> [options]')
    expect(result.stdout).toContain('Notes:')
    expect(result.stdout).toContain('Run `otalan login` to authenticate to a project; `otalan init` selects an active app in that project.')
    expect(result.stdout).toContain('Otalan validates release ZIPs before `otalan publish` succeeds.')
    expect(result.stdout).toContain('Release commands require the configured app to be active, not archived.')
    expect(result.stdout).toContain('Run `otalan <command> --help` to show this help text.')
    expect(result.stdout).not.toContain('Capacitor packages prebuilt web assets')
    expect(result.stdout).not.toContain('Expo runs `bunx expo export`')
    expect(result.stdout).not.toContain('Expo runtimeVersion comes from')
    expect(result.stdout).not.toContain('Use an OTA Publish Key with the CLI.')
    expect(result.stdout).not.toContain('Get OTA Publish Keys from https://otalan.com/api-keys.')
    expect(result.stdout).not.toContain('Release commands print the resolved organization and project before continuing.')
    expect(result.stderr).toBe('')
  })

  test('upload is rejected as an unknown command', async () => {
    const result = await runCli(['upload'])

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Unknown command: upload')
  })

  test('login --help prints help text without triggering login prompts', async () => {
    const result = await runCli(['login', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(`Otalan CLI ${await readPackageVersion()}`)
    expect(result.stdout).toContain('Usage: otalan <command> [options]')
    expect(result.stdout).not.toContain('Otalan API URL (')
    expect(result.stdout).not.toContain('Get your OTA Publish Key from:')
    expect(result.stdout).not.toContain('OTA Publish Key:')
    expect(result.stderr).toBe('')
  })

  test('init --help prints help text without triggering init prompts', async () => {
    const result = await runCli(['init', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(`Otalan CLI ${await readPackageVersion()}`)
    expect(result.stdout).toContain('Usage: otalan <command> [options]')
    expect(result.stdout).not.toContain('App ID:')
    expect(result.stderr).toBe('')
  })
})

describe('CLI keygen', () => {
  test('generates an OTA Publish Key and prints the suffix separately', async () => {
    const result = await runCli(['keygen', '--kind', 'ci'])
    const lines = result.stdout.trim().split('\n')
    const fullKey = lines.at(3)
    const suffix = lines.at(6)

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(lines.at(0)).toBe('Generated OTA Publish Key.')
    expect(fullKey).toMatch(/^otalan_ci_[A-Za-z0-9_-]{32}$/)
    expect(suffix).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(fullKey).toBe(`otalan_ci_${suffix}`)
  })

  test('generates an OTA App Key and prints the suffix separately', async () => {
    const result = await runCli(['keygen', '--kind', 'ota'])
    const lines = result.stdout.trim().split('\n')
    const fullKey = lines.at(3)
    const suffix = lines.at(6)

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(lines.at(0)).toBe('Generated OTA App Key.')
    expect(fullKey).toMatch(/^otalan_ota_[A-Za-z0-9_-]{32}$/)
    expect(suffix).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(fullKey).toBe(`otalan_ota_${suffix}`)
  })

  test('rejects invalid key kinds', async () => {
    const result = await runCli(['keygen', '--kind', 'admin'])

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Key kind is required. Use --kind ci or --kind ota.')
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
