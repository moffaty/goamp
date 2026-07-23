export type Unsubscribe = () => void

export interface IEventBus {
  on<T>(event: string, cb: (payload: T) => void): Unsubscribe
  emit<T>(event: string, payload: T): void
}

export class EventBus implements IEventBus {
  private listeners = new Map<string, Set<(payload: unknown) => void>>()

  on<T>(event: string, cb: (payload: T) => void): Unsubscribe {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    const handler = cb as (payload: unknown) => void
    this.listeners.get(event)!.add(handler)
    return () => this.listeners.get(event)?.delete(handler)
  }

  emit<T>(event: string, payload: T): void {
    this.listeners.get(event)?.forEach((cb) => cb(payload))
  }
}
