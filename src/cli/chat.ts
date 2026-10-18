export interface ChatConfirmation {
  token: string
  tool: string
  argumentsPreview: Record<string, unknown>
  expiresAt: string
}

export interface ChatReply {
  conversationId?: string
  status: string
  reply?: string
  confirmation?: ChatConfirmation
  error?: { code: string; message: string }
}

export class ChatHttpError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'ChatHttpError'
    this.code = code
    this.status = status
  }
}

export interface ChatClientOptions {
  baseUrl: string
  token: string
  fetchImpl?: typeof fetch
}

export interface ChatClient {
  send(message: string, conversationId?: string): Promise<ChatReply>
  confirm(
    conversationId: string,
    confirmationToken: string,
    decision: 'approve' | 'reject',
  ): Promise<ChatReply>
}

async function readError(response: Response): Promise<{ code: string; message: string }> {
  try {
    const payload = (await response.json()) as { error?: { code?: string; message?: string } }
    return {
      code: payload.error?.code ?? 'internal_error',
      message: payload.error?.message ?? 'Request failed.',
    }
  } catch {
    return { code: 'internal_error', message: `Request failed with status ${response.status}.` }
  }
}

export function createChatClient(options: ChatClientOptions): ChatClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const base = options.baseUrl.replace(/\/$/, '')

  const post = async (path: string, body: unknown): Promise<ChatReply> => {
    const response = await fetchImpl(`${base}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.token}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const { code, message } = await readError(response)
      throw new ChatHttpError(code, message, response.status)
    }

    return (await response.json()) as ChatReply
  }

  return {
    send: (message, conversationId) =>
      post('/conversation', conversationId ? { message, conversationId } : { message }),
    confirm: (conversationId, confirmationToken, decision) =>
      post('/confirm', { conversationId, confirmationToken, decision }),
  }
}
