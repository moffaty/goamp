import { invoke } from '@tauri-apps/api/core'

export interface ITransport {
  call<T>(command: string, args?: Record<string, unknown>): Promise<T>
}

export class TauriTransport implements ITransport {
  call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    return invoke<T>(command, args)
  }
}

export class MockTransport implements ITransport {
  calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  private responses = new Map<string, unknown>()

  setResponse(command: string, value: unknown): void {
    this.responses.set(command, value)
  }

  async call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    this.calls.push({ command, args })
    const response = this.responses.get(command)
    if (response instanceof Error) throw response
    return response as T
  }

  get lastCall() {
    return this.calls[this.calls.length - 1]
  }

  reset(): void {
    this.calls = []
    this.responses.clear()
  }
}
