import { describe, expect, it } from 'vitest'
import { ChatHttpError, createChatClient } from '../../src/cli/chat.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('chat client', () => {
  it('sends a message and returns the reply', async () => {
    let seenBody: Record<string, unknown> = {}
    const client = createChatClient({
      baseUrl: 'http://agent.test',
      token: 'tok',
      fetchImpl: async (_url, init) => {
        seenBody = JSON.parse(String(init?.body))
        return jsonResponse({ conversationId: 'c-1', status: 'completed', reply: 'hi' })
      },
    })
    const reply = await client.send('when is the bus?')
    expect(reply.status).toBe('completed')
    expect(reply.conversationId).toBe('c-1')
    expect(seenBody.message).toBe('when is the bus?')
  })

  it('returns confirmation requests', async () => {
    const client = createChatClient({
      baseUrl: 'http://agent.test',
      token: 'tok',
      fetchImpl: async () =>
        jsonResponse({
          conversationId: 'c-1',
          status: 'confirmation_required',
          confirmation: {
            token: 't',
            tool: 'tasks.task.delete',
            argumentsPreview: { id: 42 },
            expiresAt: 'x',
          },
        }),
    })
    const reply = await client.send('delete task 42')
    expect(reply.status).toBe('confirmation_required')
    expect(reply.confirmation?.tool).toBe('tasks.task.delete')
  })

  it('posts approve decisions to /confirm', async () => {
    let path = ''
    const client = createChatClient({
      baseUrl: 'http://agent.test',
      token: 'tok',
      fetchImpl: async (url, init) => {
        path = new URL(String(url)).pathname
        expect(JSON.parse(String(init?.body)).decision).toBe('approve')
        return jsonResponse({ conversationId: 'c-1', status: 'completed', reply: 'done' })
      },
    })
    await client.confirm('c-1', 'token-1', 'approve')
    expect(path).toBe('/confirm')
  })

  it('throws ChatHttpError with the machine-readable code', async () => {
    const client = createChatClient({
      baseUrl: 'http://agent.test',
      token: 'bad',
      fetchImpl: async () =>
        jsonResponse({ error: { code: 'unauthorized', message: 'nope' } }, 401),
    })
    await expect(client.send('hi')).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
    await expect(client.send('hi')).rejects.toBeInstanceOf(ChatHttpError)
  })
})
