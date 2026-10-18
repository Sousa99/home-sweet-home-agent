import { createServer, type Server as HttpServer } from 'node:http'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

export interface FakeTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  handler: (args: Record<string, unknown>) => unknown | Promise<unknown>
  isError?: boolean
}

export interface FakeMcpServer {
  url: string
  port: number
  calls: Array<{ name: string; args: Record<string, unknown> }>
  close(): Promise<void>
}

export interface FakeMcpServerOptions {
  tools: FakeTool[]
}

export async function startFakeMcpServer(options: FakeMcpServerOptions): Promise<FakeMcpServer> {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []

  const buildServer = (): Server => {
    const server = new Server(
      { name: 'fake-mcp', version: '0.0.0' },
      { capabilities: { tools: {} } },
    )
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: options.tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? '',
        inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
      })),
    }))
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tool = options.tools.find((candidate) => candidate.name === request.params.name)
      if (!tool) {
        return {
          content: [{ type: 'text', text: `Unknown tool ${request.params.name}` }],
          isError: true,
        }
      }
      const args = (request.params.arguments ?? {}) as Record<string, unknown>
      calls.push({ name: tool.name, args })
      const output = await tool.handler(args)
      return {
        content: [
          { type: 'text', text: typeof output === 'string' ? output : JSON.stringify(output) },
        ],
        isError: Boolean(tool.isError),
      }
    })
    return server
  }

  const httpServer: HttpServer = createServer((req, res) => {
    void (async () => {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      const server = buildServer()
      res.on('close', () => {
        void transport.close()
        void server.close()
      })
      try {
        await server.connect(transport)
        await transport.handleRequest(req, res)
      } catch {
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'fake_mcp_error' }))
        }
      }
    })()
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(0, '127.0.0.1', () => resolve())
  })

  const address = httpServer.address()
  const port = typeof address === 'object' && address ? address.port : 0

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    port,
    calls,
    close: () =>
      new Promise<void>((resolve) => {
        httpServer.close(() => resolve())
        httpServer.closeAllConnections()
      }),
  }
}

export function readTool(
  name: string,
  inputSchema: Record<string, unknown>,
  output: unknown,
): FakeTool {
  return { name, description: `read tool ${name}`, inputSchema, handler: () => output }
}
