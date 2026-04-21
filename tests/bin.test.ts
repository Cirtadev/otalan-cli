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

describe('CLI help', () => {
  test('help reflects the publish-only release workflow', async () => {
    const result = await runCli(['help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Publish the current bundle ZIP with rollout metadata.')
    expect(result.stdout).not.toContain('upload')
    expect(result.stdout).not.toContain('--storage-key')
    expect(result.stdout).not.toContain('--download-url')
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
    expect(result.stdout).toContain('Usage: otalan <command> [options]')
    expect(result.stdout).not.toContain('Otalan API URL (')
    expect(result.stdout).not.toContain('Get your CI key from:')
    expect(result.stdout).not.toContain('CI key:')
    expect(result.stderr).toBe('')
  })

  test('init --help prints help text without triggering init prompts', async () => {
    const result = await runCli(['init', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage: otalan <command> [options]')
    expect(result.stdout).not.toContain('App ID:')
    expect(result.stderr).toBe('')
  })
})
