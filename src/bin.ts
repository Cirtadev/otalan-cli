#!/usr/bin/env bun

import { parseArgs, readBooleanOption } from './cli/args'
import type { CommandContext } from './cli/helpers'
import { printHelp } from './cli/output'
import { formatError } from './cli/ui'
import { handleDoctor, handleInit, handleLogin } from './commands/auth'
import { handleBundle } from './commands/bundle'
import { handleKeygen } from './commands/keygen'
import {
  handleBundlesList,
  handleChannelsList,
  handlePause,
  handlePublish,
  handleResume,
  handleRollback,
  handleStatus,
} from './commands/release'

interface PackageMetadata {
  version?: unknown
}

async function readCliVersion() {
  const packageUrl = new URL('../package.json', import.meta.url)
  const packageMetadata = await Bun.file(packageUrl).json() as PackageMetadata

  if (typeof packageMetadata.version !== 'string') {
    throw new Error('Unable to read CLI version from package.json.')
  }

  return packageMetadata.version
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  const context: CommandContext = {
    cwd: process.cwd(),
  }

  if (readBooleanOption(parsed.options, 'help', false, ['h'])) {
    printHelp(await readCliVersion())
    return
  }

  switch (parsed.command) {
    case 'login':
      await handleLogin(parsed.options)
      return
    case 'init':
      await handleInit(context, parsed.options)
      return
    case 'doctor':
      await handleDoctor(parsed.options)
      return
    case 'keygen':
      await handleKeygen(parsed.options)
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
    case 'pause':
      await handlePause(context, parsed.options)
      return
    case 'resume':
      await handleResume(context, parsed.options)
      return
    case 'help':
      printHelp(await readCliVersion())
      return
    case 'version':
    case '--version':
    case '-v':
      console.log(await readCliVersion())
      return
    case 'status':
      await handleStatus(context, parsed.options)
      return
    case 'channels':
      await handleChannelsList(parsed.options)
      return
    case 'bundles':
      if (!parsed.subcommand || parsed.subcommand === 'ls') {
        await handleBundlesList(context, parsed.options)
        return
      }

      printHelp(await readCliVersion())
      return
    case '--help':
    case '-h':
      printHelp(await readCliVersion())
      return
    case undefined:
      printHelp(await readCliVersion())
      return
    default:
      throw new Error(`Unknown command: ${parsed.command}`)
  }
}

function formatFatalError(error: unknown) {
  if (error instanceof Error) {
    return process.env.OTALAN_DEBUG === '1'
      ? error.stack ?? error.message
      : formatError(error.message)
  }

  return formatError(String(error))
}

;(async () => {
  try {
    await main()
  } catch (error) {
    console.error(formatFatalError(error))
    process.exitCode = 1
  }
})()
