import { createHash, randomBytes } from 'node:crypto'
import { PERMISSIONS, type Permission } from './caller.js'

export interface TokenEntry {
  callerId: string
  permissions: Permission[]
}

export interface GeneratedToken {
  token: string
  tokenHash: string
  entry: TokenEntry
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

export interface GenerateTokenEntryInput {
  callerId: string
  permissions: readonly Permission[]
  token?: string
}

export function generateTokenEntry(input: GenerateTokenEntryInput): GeneratedToken {
  const callerId = input.callerId?.trim()
  if (!callerId) {
    throw new Error('callerId must be a non-empty string')
  }

  if (!input.permissions || input.permissions.length === 0) {
    throw new Error('at least one permission is required')
  }

  const permissions = [...new Set(input.permissions)]
  for (const permission of permissions) {
    if (!PERMISSIONS.includes(permission)) {
      throw new Error(`unknown permission: ${String(permission)}`)
    }
  }

  const token = input.token?.trim() || generateToken()
  if (!token) {
    throw new Error('token must be a non-empty string')
  }

  return { token, tokenHash: hashToken(token), entry: { callerId, permissions } }
}
