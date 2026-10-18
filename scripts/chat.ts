import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { ChatHttpError, createChatClient, type ChatReply } from '../src/cli/chat.js'

// Allow `pnpm chat` to read AGENT_URL / AGENT_TOKEN from a local .env file.
try {
  process.loadEnvFile()
} catch {
  // no .env file present; rely on the ambient environment
}

interface ParsedArgs {
  url: string
  token: string
  once?: string
  conversation?: string
  verbose: boolean
  help: boolean
}

const USAGE = `Usage: pnpm chat -- [--url <base-url>] [--token <bearer>] [options]

A tiny local chat client for the Home Sweet Home agent.

Options:
  --url <url>            Agent base URL (default: $AGENT_URL or http://127.0.0.1:3400)
  --token <bearer>       Bearer token (default: $AGENT_TOKEN)
  --once <message>       Send one message, print the reply, and exit
  --conversation <id>    Continue an existing conversation
  --verbose              Print raw reply JSON
  -h, --help             Show this help

Examples:
  pnpm chat -- --token "$TOKEN"
  pnpm chat -- --token "$TOKEN" --once "When is the next bus at my stop?"
`

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    url: process.env.AGENT_URL ?? 'http://127.0.0.1:3400',
    token: process.env.AGENT_TOKEN ?? '',
    verbose: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--verbose') args.verbose = true
    else if (arg === '--url') args.url = argv[++i] ?? args.url
    else if (arg === '--token') args.token = argv[++i] ?? args.token
    else if (arg === '--once') args.once = argv[++i]
    else if (arg === '--conversation') args.conversation = argv[++i]
  }
  return args
}

function printReply(reply: ChatReply, verbose: boolean): void {
  if (verbose) {
    process.stdout.write(`${JSON.stringify(reply, null, 2)}\n`)
    return
  }
  if (reply.reply) {
    process.stdout.write(`agent> ${reply.reply}\n`)
  }
  if (reply.status === 'confirmation_required' && reply.confirmation) {
    process.stdout.write(
      `       tool: ${reply.confirmation.tool}  args: ${JSON.stringify(reply.confirmation.argumentsPreview)}\n`,
    )
  }
  if (reply.status === 'failed' && reply.error) {
    process.stdout.write(`agent! [${reply.error.code}] ${reply.error.message}\n`)
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(`${USAGE}\n`)
    return
  }
  if (!args.token) {
    process.stderr.write('A bearer token is required: pass --token or set AGENT_TOKEN.\n')
    process.stderr.write(
      'Generate one with: pnpm token:generate -- --caller-id you --permissions read,write,destructive\n',
    )
    process.exitCode = 1
    return
  }

  const client = createChatClient({ baseUrl: args.url, token: args.token })
  let conversationId: string | undefined = args.conversation

  const send = async (message: string): Promise<ChatReply> => {
    try {
      const reply = await client.send(message, conversationId)
      conversationId = reply.conversationId ?? conversationId
      return reply
    } catch (error) {
      if (error instanceof ChatHttpError) {
        return { status: 'failed', error: { code: error.code, message: error.message } }
      }
      return {
        status: 'failed',
        error: { code: 'connection_error', message: `Could not reach the agent at ${args.url}.` },
      }
    }
  }

  if (args.once !== undefined) {
    const reply = await send(args.once)
    printReply(reply, args.verbose)
    if (reply.status === 'confirmation_required' && reply.confirmation) {
      process.stdout.write(
        `       approve with: pnpm chat -- --token <token> --conversation ${reply.conversationId}\n`,
      )
    }
    return
  }

  const rl = createInterface({ input: stdin, output: stdout })
  process.stdout.write(`agent(${args.url})${conversationId ? ` · ${conversationId}` : ''}\n`)
  try {
    for (;;) {
      const message = (await rl.question('you> ')).trim()
      if (!message) continue
      if (message === 'exit' || message === 'quit') break

      const reply = await send(message)
      printReply(reply, args.verbose)

      if (reply.status === 'confirmation_required' && reply.confirmation) {
        const answer = (await rl.question('       approve? [y/N] ')).trim().toLowerCase()
        const decision = answer === 'y' || answer === 'yes' ? 'approve' : 'reject'
        try {
          const confirmed = await client.confirm(
            conversationId ?? reply.conversationId ?? '',
            reply.confirmation.token,
            decision,
          )
          printReply(confirmed, args.verbose)
        } catch (error) {
          if (error instanceof ChatHttpError) {
            process.stdout.write(`agent! [${error.code}] ${error.message}\n`)
          } else {
            throw error
          }
        }
      }
    }
  } finally {
    rl.close()
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error'
  process.stderr.write(`chat failed: ${message}\n`)
  process.exitCode = 1
})
