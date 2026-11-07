import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { AGENT_NAME, AGENT_VERSION } from '../version.js'

export { AGENT_NAME, AGENT_VERSION }

export interface McpClientHandle {
  client: Client
  transport: StreamableHTTPClientTransport
  close(): Promise<void>
}

export function createMcpClient(options: {
  url: string
  signal?: AbortSignal
  headers?: Record<string, string>
}): McpClientHandle {
  const client = new Client({ name: AGENT_NAME, version: AGENT_VERSION })
  const requestInit: { signal?: AbortSignal; headers?: Record<string, string> } = {}
  if (options.signal) requestInit.signal = options.signal
  if (options.headers) requestInit.headers = options.headers
  const transport = new StreamableHTTPClientTransport(new URL(options.url), {
    requestInit: Object.keys(requestInit).length > 0 ? requestInit : undefined,
  })
  return {
    client,
    transport,
    close: async () => {
      await client.close()
    },
  }
}
