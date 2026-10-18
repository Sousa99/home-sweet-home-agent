import { Hono } from 'hono'
import {
  notificationSchema,
  toNotificationEvent,
  validateNotification,
} from '../../notifications/contract.js'
import type { AppEnv, RouteDeps } from '../context.js'
import { AgentError } from '../errors.js'
import { readJsonBody } from '../read-json.js'

export function notificationRoutes(deps: RouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.post('/', async (c) => {
    const raw = await readJsonBody(c)
    const check = validateNotification(raw)
    if (!check.ok) {
      throw new AgentError('malformed_request', `Invalid notification: ${check.issues.join('; ')}`)
    }

    const input = notificationSchema.parse(raw)
    const event = toNotificationEvent(input, deps.generateId(), deps.now)
    deps.notifications.record(event)
    deps.logger.info('notification.accepted', { type: event.type, severity: event.severity })

    return c.json({ accepted: true, id: event.id, receivedAt: event.receivedAt }, 202)
  })

  return app
}
