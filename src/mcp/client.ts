import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { AGENT_NAME, AGENT_VERSION } from '../version.js'

export { AGENT_NAME, AGENT_VERSION }

export interface McpClientHandle {
  client: Client
  transport: StreamableHTTPClientTransport
  close(): Promise<void>
}

export function createMcpClient(options: { url: string; signal?: AbortSignal }): McpClientHandle {
  const client = new Client({ name: AGENT_NAME, version: AGENT_VERSION })
  const transport = new StreamableHTTPClientTransport(new URL(options.url), {
    requestInit: options.signal ? { signal: options.signal } : undefined,
  })
  return {
    client,
    transport,
    close: async () => {
      await client.close()
    },
  }
}
