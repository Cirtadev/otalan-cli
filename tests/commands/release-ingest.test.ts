import { describe, expect, test } from 'bun:test'

import { releaseTestUtils } from '../../src/commands/release'
import { createIngest } from './release.fixtures'

describe('releaseTestUtils.waitForReleaseIngest', () => {
  test('waits until the ingest reaches ready', async () => {
    const observedStatuses: string[] = []
    const clock = { now: 0 }

    const completed = await releaseTestUtils.waitForReleaseIngest({
      ingest: createIngest(),
      loadIngest: async () => {
        if (observedStatuses.length === 0) {
          return createIngest({
            status: 'processing',
          })
        }

        return createIngest({
          status: 'ready',
          checksum: 'abc123',
          processedAt: '2026-04-21T00:00:03.000Z',
        })
      },
      onStatusChange: ingest => {
        observedStatuses.push(ingest.status)
      },
      pollIntervalMs: 1,
      timeoutMs: 10,
      sleep: async () => {
        clock.now += 1
      },
      now: () => clock.now,
    })

    expect(observedStatuses).toEqual(['processing', 'ready'])
    expect(completed.status).toBe('ready')
    expect(completed.checksum).toBe('abc123')
  })

  test('returns the failed ingest so callers can surface the failure reason', async () => {
    const failed = await releaseTestUtils.waitForReleaseIngest({
      ingest: createIngest(),
      loadIngest: async () =>
        createIngest({
          status: 'failed',
          failureReason: 'Checksum mismatch',
          processedAt: '2026-04-21T00:00:02.000Z',
        }),
      pollIntervalMs: 1,
      timeoutMs: 10,
      sleep: async () => undefined,
      now: () => 0,
    })

    expect(failed.status).toBe('failed')
    expect(failed.failureReason).toBe('Checksum mismatch')
  })

  test('times out when the ingest never reaches a terminal state', async () => {
    const clock = { now: 0 }

    await expect(releaseTestUtils.waitForReleaseIngest({
      ingest: createIngest(),
      loadIngest: async () =>
        createIngest({
          status: 'processing',
        }),
      pollIntervalMs: 2,
      timeoutMs: 5,
      sleep: async (ms: number) => {
        clock.now += ms
      },
      now: () => clock.now,
    })).rejects.toThrow('Timed out waiting for release validation. Ingest ingest-123 is still processing.')
  })
})

describe('releaseTestUtils.resolveRolloutPercent', () => {
  test('defaults to 100 when the option is omitted', () => {
    expect(releaseTestUtils.resolveRolloutPercent({})).toBe(100)
  })

  test('accepts integer percentages in range', () => {
    expect(releaseTestUtils.resolveRolloutPercent({
      'rollout-percent': '25',
    })).toBe(25)
  })

  test('rejects fractional percentages before calling the API', () => {
    expect(() => releaseTestUtils.resolveRolloutPercent({
      'rollout-percent': '25.5',
    })).toThrow('rollout-percent must be an integer between 0 and 100.')
  })
})
