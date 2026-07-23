export interface IKVStorage {
  get<T>(key: string): T | null
  set<T>(key: string, value: T): void
  remove(key: string): void
}

export class LocalKVStorage implements IKVStorage {
  constructor(private readonly prefix: string) {}

  get<T>(key: string): T | null {
    const raw = localStorage.getItem(`${this.prefix}:${key}`)
    if (raw === null) return null
    try { return JSON.parse(raw) as T } catch { return null }
  }

  set<T>(key: string, value: T): void {
    localStorage.setItem(`${this.prefix}:${key}`, JSON.stringify(value))
  }

  remove(key: string): void {
    localStorage.removeItem(`${this.prefix}:${key}`)
  }
}
