import { createServer } from 'node:http'

const host = process.env.AGENT_HOST ?? '127.0.0.1'
const port = Number(process.env.AGENT_PORT ?? 3400)

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ status: 'ok', service: 'home-sweet-home-agent' }))
    return
  }

  response.writeHead(404, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ error: 'not_found' }))
})

server.listen(port, host, () => {
  console.log(`home-sweet-home-agent listening on ${host}:${port}`)
})
