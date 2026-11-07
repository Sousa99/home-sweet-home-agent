import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

describe('container image contract', () => {
  it('builds reproducibly from the lockfile and runs as a non-root user', () => {
    const dockerfile = read('../../Dockerfile')

    expect(dockerfile).toMatch(/pnpm install --frozen-lockfile/)
    expect(dockerfile).toMatch(/pnpm install --prod --frozen-lockfile/)
    expect(dockerfile).toMatch(/^USER node$/m)
    expect(dockerfile).toMatch(/ENV AGENT_HOST=0\.0\.0\.0/)
    expect(dockerfile).toMatch(/CMD \["node", "dist\/index\.js"\]/)
  })

  it('keeps secrets out of the build context', () => {
    const dockerignore = read('../../.dockerignore')
      .split('\n')
      .map((line) => line.trim())

    expect(dockerignore).toContain('secrets')
    expect(dockerignore).toContain('.env*')
  })

  it('allows the esbuild dependency to run its install script', () => {
    const workspace = read('../../pnpm-workspace.yaml')

    expect(workspace).toMatch(/esbuild:\s*true/)
  })

  it('publishes a versioned image to GHCR from main', () => {
    const workflow = read('../../.github/workflows/publish-agent.yml')

    expect(workflow).toMatch(/branches:\s*\n\s*-\s*main/)
    expect(workflow).toMatch(/ghcr\.io\/sousa99\/home-sweet-home-agent/)
    expect(workflow).toMatch(/main-\$\(date -u \+%Y%m%d%H%M%S\)-\$\{GITHUB_SHA::7\}/)
    expect(workflow).toMatch(/docker\/build-push-action@v6/)
    expect(workflow).toMatch(/pnpm test/)
  })
})
