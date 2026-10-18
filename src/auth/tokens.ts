import { timingSafeEqual } from 'node:crypto'
import type { CallerIdentity } from './caller.js'
import { hashToken, type TokenEntry } from './token-tool.js'

export type TokenMap = Record<string, TokenEntry>

export function parseBearer(header: string | null | undefined): string | null {
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1].trim() : null
}

export function findTokenEntry(token: string, tokens: TokenMap): TokenEntry | null {
  const candidate = Buffer.from(hashToken(token), 'hex')
  let match: TokenEntry | null = null
  for (const [key, entry] of Object.entries(tokens)) {
    if (key.length !== 64) continue
    const keyBuf = Buffer.from(key, 'hex')
    if (keyBuf.length !== candidate.length) continue
    if (timingSafeEqual(keyBuf, candidate)) {
      match = entry
    }
  }
  return match
}

export function authenticate(token: string, tokens: TokenMap): CallerIdentity | null {
  const entry = findTokenEntry(token, tokens)
  if (!entry) return null
  return { callerId: entry.callerId, permissions: entry.permissions }
}

export function tokenFingerprint(token: string): string {
  return hashToken(token).slice(0, 8)
}
