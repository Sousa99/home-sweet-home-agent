import { describe, expect, it } from 'vitest'
import { createMcpClient } from '../../src/mcp/client.js'
import { startFakeMcpServer, type FakeMcpServer } from '../fakes/fake-mcp-server.js'

describe('createMcpClient request headers', () => {
  it('sends configured headers such as Authorization to the MCP server', async () => {
    let server: FakeMcpServer | undefined
    try {
      server = await startFakeMcpServer({
        tools: [{ name: 'ping', handler: () => 'pong' }],
      })
      const handle = createMcpClient({
        url: server.url,
        headers: { Authorization: 'Bearer test-token' },
      })
      await handle.client.connect(handle.transport)
      await handle.client.listTools()
      await handle.close()

      expect(server.headers.some((h) => h.authorization === 'Bearer test-token')).toBe(true)
    } finally {
      await server?.close()
    }
  })
})
