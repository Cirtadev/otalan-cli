import path from 'node:path'

import { describe, expect, test } from 'bun:test'

const PROJECT_ROOT = path.resolve(import.meta.dir, '..')

async function readPackageVersion() {
  const packageJson = await Bun.file(path.join(PROJECT_ROOT, 'package.json')).json() as {
    version?: unknown
  }

  if (typeof packageJson.version !== 'string') {
    throw new Error('package.json version must be a string.')
  }

  return packageJson.version
}

describe('release metadata', () => {
  test('documents the current package version in the changelog', async () => {
    const version = await readPackageVersion()
    const changelog = await Bun.file(path.join(PROJECT_ROOT, 'CHANGELOG.md')).text()

    expect(changelog).toContain(`## ${version} - `)
  })
})
