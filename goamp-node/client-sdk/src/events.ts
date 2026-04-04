import type { GoampEvent, GoampEventType } from "./types.js";

type Listener<T = unknown> = (payload: T) => void;

/** EventEmitter for strongly-typed GOAMP WebSocket events. */
export class GoampEventEmitter {
  private listeners = new Map<string, Set<Listener>>();

  on<T = unknown>(type: GoampEventType | string, listener: Listener<T>): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener as Listener);
    return () => this.off(type, listener);
  }

  off<T = unknown>(type: string, listener: Listener<T>): void {
    this.listeners.get(type)?.delete(listener as Listener);
  }

  emit(event: GoampEvent): void {
    this.listeners.get(event.type)?.forEach((l) => l(event.payload));
    this.listeners.get("*")?.forEach((l) => l(event));
  }
}
