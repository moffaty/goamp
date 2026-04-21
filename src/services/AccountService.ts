import type { ITransport } from './transport'
import type { CreatedAccount, CurrentAccount, DevicesList, IAccountService, RecoveredAccount } from './interfaces'

interface RawCreated {
  mnemonic: string
  account_pub: string
  quiz_positions: number[]
}

interface RawCurrent {
  account_pub: string
  sub_pub: string
  provisioned: boolean
}

export class AccountService implements IAccountService {
  constructor(private readonly t: ITransport) {}

  async create(deviceName: string, os: string): Promise<CreatedAccount> {
    const r = await this.t.call<RawCreated>('account_create', { deviceName, os })
    return {
      mnemonic: r.mnemonic,
      accountPub: r.account_pub,
      quizPositions: r.quiz_positions,
    }
  }

  async current(): Promise<CurrentAccount | null> {
    const r = await this.t.call<RawCurrent | null>('account_current')
    if (!r) return null
    return {
      accountPub: r.account_pub,
      subPub: r.sub_pub,
      provisioned: r.provisioned,
    }
  }

  async forget(accountPub: string): Promise<void> {
    await this.t.call<void>('account_forget', { accountPub })
  }

  verifyQuiz(mnemonic: string[], positions: number[], answers: string[]): boolean {
    if (answers.length !== positions.length) return false
    for (let i = 0; i < positions.length; i++) {
      const want = (mnemonic[positions[i]] ?? '').toLowerCase().trim()
      const got = (answers[i] ?? '').toLowerCase().trim()
      if (want === '' || want !== got) return false
    }
    return true
  }

  async recover(mnemonic: string, deviceName: string, os: string, relayUrl: string): Promise<RecoveredAccount> {
    const r = await this.t.call<{ account_pub: string; sub_pub: string; manifest_version: number }>(
      'account_recover',
      { mnemonic, deviceName, os, relayUrl },
    )
    return {
      accountPub: r.account_pub,
      subPub: r.sub_pub,
      manifestVersion: r.manifest_version,
    }
  }

  async listDevices(accountPub: string, relayUrl: string): Promise<DevicesList> {
    const r = await this.t.call<{ devices: Array<{ sub_pub: string; name: string; os: string; added_at: string }>; version: number }>(
      'account_list_devices',
      { accountPub, relayUrl },
    )
    return {
      devices: r.devices.map((d) => ({
        subPub: d.sub_pub,
        name: d.name,
        os: d.os,
        addedAt: d.added_at,
      })),
      version: r.version,
    }
  }

  async revokeDevice(
    mnemonic: string,
    accountPub: string,
    subPubToRevoke: string,
    reason: string,
    relayUrl: string,
  ): Promise<number> {
    return this.t.call<number>('account_revoke_device', {
      mnemonic, accountPub, subPubToRevoke, reason, relayUrl,
    })
  }
}
