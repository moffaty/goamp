import type { ModuleContext } from './ModuleContext'

export interface IFeature {
  readonly id: string

  init(ctx: ModuleContext): Promise<void>
  destroy(): void
}
