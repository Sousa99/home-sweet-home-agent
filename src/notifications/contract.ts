import { z } from 'zod'

export const NOTIFICATION_TYPES = [
  'bus.departure',
  'task.due',
  'flight.overhead',
  'service.health',
] as const

export const notificationSchema = z.object({
  type: z.enum(NOTIFICATION_TYPES),
  severity: z.enum(['info', 'warning', 'critical']).default('info'),
  payload: z.record(z.string(), z.unknown()),
  target: z.string().min(1).optional(),
})

export type NotificationInput = z.infer<typeof notificationSchema>

export interface NotificationEvent {
  id: string
  type: NotificationInput['type']
  severity: NotificationInput['severity']
  payload: Record<string, unknown>
  target?: string
  receivedAt: string
}

export interface NotificationCheck {
  ok: boolean
  issues: string[]
}

export function validateNotification(input: unknown): NotificationCheck {
  const result = notificationSchema.safeParse(input)
  if (result.success) return { ok: true, issues: [] }
  return {
    ok: false,
    issues: result.error.issues.map(
      (issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`,
    ),
  }
}

export function toNotificationEvent(
  input: NotificationInput,
  id: string,
  now: () => number,
): NotificationEvent {
  const event: NotificationEvent = {
    id,
    type: input.type,
    severity: input.severity,
    payload: input.payload,
    receivedAt: new Date(now()).toISOString(),
  }
  if (input.target) event.target = input.target
  return event
}

export class NotificationRecorder {
  private readonly events: NotificationEvent[] = []

  record(event: NotificationEvent): void {
    this.events.push(event)
  }

  list(): NotificationEvent[] {
    return [...this.events]
  }

  get size(): number {
    return this.events.length
  }
}
