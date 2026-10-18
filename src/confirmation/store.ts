import { randomBytes } from 'node:crypto'
import { hashToken } from '../auth/token-tool.js'
import type { ErrorCode } from '../http/errors.js'

export type ConfirmationState = 'pending' | 'consumed' | 'rejected' | 'expired'

export interface PendingConfirmation {
  token: string
  callerId: string
  conversationId: string
  sourceId: string
  toolName: string
  args: Record<string, unknown>
  argumentsHash: string
  expiresAt: number
  state: ConfirmationState
}

export interface ConfirmationDraft {
  callerId: string
  conversationId: string
  sourceId: string
  toolName: string
  args: Record<string, unknown>
}

export type ClaimResult = { ok: true; entry: PendingConfirmation } | { ok: false; code: ErrorCode }

export interface ConfirmationStoreOptions {
  ttlMs: number
  now?: () => number
  generateToken?: () => string
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

export class ConfirmationStore {
  private readonly entries = new Map<string, PendingConfirmation>()
  private readonly ttlMs: number
  private readonly now: () => number
  private readonly generateToken: () => string

  constructor(options: ConfirmationStoreOptions) {
    this.ttlMs = options.ttlMs
    this.now = options.now ?? (() => Date.now())
    this.generateToken = options.generateToken ?? (() => randomBytes(24).toString('base64url'))
  }

  create(draft: ConfirmationDraft): PendingConfirmation {
    const token = this.generateToken()
    const entry: PendingConfirmation = {
      token,
      callerId: draft.callerId,
      conversationId: draft.conversationId,
      sourceId: draft.sourceId,
      toolName: draft.toolName,
      args: draft.args,
      argumentsHash: hashToken(stableStringify(draft.args)),
      expiresAt: this.now() + this.ttlMs,
      state: 'pending',
    }
    this.entries.set(token, entry)
    return entry
  }

  get(token: string): PendingConfirmation | undefined {
    return this.entries.get(token)
  }

  claim(token: string, callerId: string): ClaimResult {
    const entry = this.entries.get(token)
    if (!entry || entry.state !== 'pending' || entry.callerId !== callerId) {
      return { ok: false, code: 'confirmation_invalid' }
    }
    if (this.now() > entry.expiresAt) {
      entry.state = 'expired'
      return { ok: false, code: 'confirmation_expired' }
    }
    entry.state = 'consumed'
    return { ok: true, entry }
  }

  reject(token: string, callerId: string): ClaimResult {
    const entry = this.entries.get(token)
    if (!entry || entry.state !== 'pending' || entry.callerId !== callerId) {
      return { ok: false, code: 'confirmation_invalid' }
    }
    if (this.now() > entry.expiresAt) {
      entry.state = 'expired'
      return { ok: false, code: 'confirmation_expired' }
    }
    entry.state = 'rejected'
    return { ok: true, entry }
  }

  get size(): number {
    return this.entries.size
  }
}
