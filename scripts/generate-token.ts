import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Permission } from '../src/auth/caller.js'
import { generateTokenEntry, type TokenEntry } from '../src/auth/token-tool.js'

interface ParsedArgs {
  callerId: string
  permissions: string
  json: boolean
  out: string
  help: boolean
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    callerId: '',
    permissions: 'read',
    json: false,
    out: '',
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--json') args.json = true
    else if (arg === '--caller-id') args.callerId = argv[++i] ?? ''
    else if (arg.startsWith('--caller-id=')) args.callerId = arg.slice('--caller-id='.length)
    else if (arg === '--permissions') args.permissions = argv[++i] ?? ''
    else if (arg.startsWith('--permissions=')) args.permissions = arg.slice('--permissions='.length)
    else if (arg === '--out') args.out = argv[++i] ?? ''
    else if (arg.startsWith('--out=')) args.out = arg.slice('--out='.length)
    else if (!arg.startsWith('-') && !args.callerId) args.callerId = arg
  }
  return args
}

const USAGE = `Usage: pnpm token:generate -- [--caller-id <id>] [--permissions read,write,destructive] [options]

Generates a random bearer token and prints it once, along with a hashed token
entry to add to the agent.

Options:
  --caller-id <id>                 Caller identity (default: household)
  --permissions <list>             Comma-separated: read,write,destructive (default: read)
  --out <file>                     Write/merge a pretty-printed token file (AGENT_TOKENS_FILE)
  --json                           Print a single-line JSON object for AGENT_AUTH_TOKENS
  -h, --help                       Show this help

Examples:
  pnpm token:generate -- --caller-id sousa --permissions read,write,destructive --out secrets/tokens.json
  pnpm token:generate -- --caller-id router --permissions read --json
`

function readExistingTokens(path: string): Record<string, TokenEntry> {
  if (!existsSync(path)) return {}
  const raw = readFileSync(path, 'utf8').trim()
  if (raw.length === 0) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, TokenEntry>
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {
    throw new Error(`${path} exists but is not valid JSON`)
  }
  throw new Error(`${path} must contain a JSON object of token entries`)
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(`${USAGE}\n`)
    return
  }

  const callerId = args.callerId || 'household'
  const permissions = args.permissions
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0) as Permission[]

  const { token, tokenHash, entry } = generateTokenEntry({ callerId, permissions })

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify({ token, agentAuthTokens: { [tokenHash]: entry } }, null, 2)}\n`,
    )
    return
  }

  const outPath = args.out ? resolve(args.out) : ''
  if (outPath) {
    const tokens = readExistingTokens(outPath)
    tokens[tokenHash] = entry
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 })
    process.stdout.write(
      [
        'Bearer token (store securely, shown only once):',
        '',
        `  ${token}`,
        '',
        `Wrote ${Object.keys(tokens).length} token entr${Object.keys(tokens).length === 1 ? 'y' : 'ies'} to ${outPath}`,
        '',
        'Point the agent at this file in your .env:',
        '',
        `  AGENT_TOKENS_FILE=${args.out}`,
        '',
        'Then start the agent and connect with:',
        '',
        `  pnpm chat -- --token ${token}`,
        '',
      ].join('\n'),
    )
    return
  }

  process.stdout.write(
    [
      'Bearer token (store securely, shown only once):',
      '',
      `  ${token}`,
      '',
      'Option A - a readable token file (recommended):',
      '',
      '  pnpm token:generate -- --caller-id <id> --permissions <list> --out secrets/tokens.json',
      '  then set AGENT_TOKENS_FILE=secrets/tokens.json in .env',
      '',
      'Option B - inline in .env (single line, no pretty printing):',
      '',
      `  AGENT_AUTH_TOKENS=${JSON.stringify({ [tokenHash]: entry })}`,
      '',
      'Then start the agent and connect with:',
      '',
      `  pnpm chat -- --token ${token}`,
      '',
    ].join('\n'),
  )
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown error'
  process.stderr.write(`Failed to generate token: ${message}\n`)
  process.exit(1)
}
