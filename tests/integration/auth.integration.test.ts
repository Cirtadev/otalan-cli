import { describe, expect, test } from 'bun:test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(import.meta.dir, '..', '..')

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
  test('uses the saved API URL without prompting when --api-key is provided', async () => {
    const homeDir = path.join(os.tmpdir(), `otalan-cli-home-${crypto.randomUUID()}`)
    const configDir = path.join(homeDir, '.otalan')
    const configPath = path.join(configDir, 'config.json')
    const apiUrl = 'http://127.0.0.1:1'

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

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Saved CLI auth.')
    expect(result.stdout).not.toContain('Otalan API URL')
    expect(savedConfig).toEqual({
      apiKey: 'test-key',
      apiUrl,
    })
  })
})
