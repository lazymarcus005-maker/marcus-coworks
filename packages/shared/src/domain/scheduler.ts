/** Resource scheduler domain (P3.5). */
export type SchedulerResource = 'remote-llm' | 'local-llm' | 'shell'

export type QueueEntry = {
  ticketId: string
  resource: SchedulerResource
  priority: number
  label?: string
  queuedAt: string
}

export type SchedulerSnapshot = {
  limits: Record<SchedulerResource, number>
  running: Record<SchedulerResource, number>
  queue: QueueEntry[]
}
