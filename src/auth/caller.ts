export type Permission = 'read' | 'write' | 'destructive'

export interface CallerIdentity {
  readonly callerId: string
  readonly permissions: readonly Permission[]
}

export const PERMISSIONS: readonly Permission[] = ['read', 'write', 'destructive']

export function hasPermission(caller: CallerIdentity, permission: Permission): boolean {
  return caller.permissions.includes(permission)
}
