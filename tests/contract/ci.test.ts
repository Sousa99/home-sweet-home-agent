import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflowUrl = new URL('../../.github/workflows/ci.yml', import.meta.url)

function workflow(): string {
  return readFileSync(workflowUrl, 'utf8')
}

describe('CI workflow', () => {
  it('runs on pull requests and pushes', () => {
    const raw = workflow()
    expect(raw).toMatch(/pull_request/)
    expect(raw).toMatch(/push:/)
  })

  it('runs every quality gate before publish', () => {
    const raw = workflow()
    for (const step of [
      'pnpm install --frozen-lockfile',
      'pnpm typecheck',
      'pnpm lint',
      'pnpm format',
      'pnpm test',
    ]) {
      expect(raw).toContain(step)
    }
  })

  it('pins a Node.js version and the repository pnpm version', () => {
    const raw = workflow()
    expect(raw).toMatch(/node-version: 24/)
    expect(raw).toMatch(/pnpm\/action-setup@v4/)
  })
})
