import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { saveGlobalConfig } from '../src/config'

// -----------------------------------------------------------------------------
// Test setup
// -----------------------------------------------------------------------------

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map(tempDir => rm(tempDir, {
    force: true,
    recursive: true,
  })))
  tempDirs.length = 0
})

// -----------------------------------------------------------------------------
// Global auth config
// -----------------------------------------------------------------------------

describe('saveGlobalConfig', () => {
  test('stores the OTA Publish Key config with owner-only permissions', async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), 'otalan-config-'))

    tempDirs.push(homeDir)

    await saveGlobalConfig({
      apiKey: 'test-key',
      apiUrl: 'https://api.otalan.com',
    }, {
      homeDir,
    })

    if (os.platform() === 'win32') {
      return
    }

    const configDirStat = await stat(path.join(homeDir, '.otalan'))
    const configStat = await stat(path.join(homeDir, '.otalan', 'config.json'))

    expect(configDirStat.mode & 0o777).toBe(0o700)
    expect(configStat.mode & 0o777).toBe(0o600)
  })
})
