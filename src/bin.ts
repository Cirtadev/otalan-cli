#!/usr/bin/env bun

import { parseArgs } from './cli/args'
import type { CommandContext } from './cli/helpers'
import { printHelp } from './cli/output'
import { handleInit, handleLogin } from './commands/auth'
import { handleBundle } from './commands/bundle'
import { handleBundlesList, handlePublish, handleRollback, handleStatus } from './commands/release'

// -----------------------------------------------------------------------------
// Entrypoint
// -----------------------------------------------------------------------------

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  const context: CommandContext = {
    cwd: process.cwd(),
  }

  if (parsed.options.help === true) {
    printHelp()
    return
  }

  switch (parsed.command) {
    case 'login':
      await handleLogin(parsed.options)
      return
    case 'init':
      await handleInit(context, parsed.options)
      return
    case 'bundle':
      await handleBundle(context, parsed.options)
      return
    case 'publish':
      await handlePublish(context, parsed.options)
      return
    case 'rollback':
      await handleRollback(context, parsed.options)
      return
    case 'help':
      printHelp()
      return
    case 'status':
      await handleStatus(context, parsed.options)
      return
    case 'bundles':
      if (!parsed.subcommand || parsed.subcommand === 'ls') {
        await handleBundlesList(context, parsed.options)
        return
      }

      printHelp()
      return
    case '--help':
    case '-h':
    case undefined:
      printHelp()
      return
    default:
      throw new Error(`Unknown command: ${parsed.command}`)
  }
}

// -----------------------------------------------------------------------------
// Process bootstrap
// -----------------------------------------------------------------------------

;(async () => {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
})()
