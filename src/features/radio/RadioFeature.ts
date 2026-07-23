import type { IFeature } from '../../core/IFeature'
import type { ModuleContext } from '../../core/ModuleContext'
import type { ITransport } from '../../services/transport'
import { RadioService } from '../../services/RadioService'

export class RadioFeature implements IFeature {
  readonly id = 'radio'

  private svc: RadioService

  constructor(transport: ITransport) {
    this.svc = new RadioService(transport)
  }

  async init(_ctx: ModuleContext): Promise<void> {
    // UI panel registration will be wired in Phase 5 via ctx.ui.registerPanel
  }

  destroy(): void {}

  get service(): RadioService {
    return this.svc
  }
}
