//! Account — OS-keychain-backed storage for the device sub-key and
//! state-encryption key. Master key is never stored here; the user writes
//! the mnemonic down.
//!
//! Keychain layout:
//!   service = "goamp/account/{account_pub}"
//!     "sub_sk"    -> base64 ed25519 private key
//!     "sub_pub"   -> hex public key
//!     "state_key" -> base64 32 bytes
//!   service = "goamp/account"
//!     "current"   -> account_pub

use keyring::Entry;
use serde::{Deserialize, Serialize};

const SERVICE_ROOT: &str = "goamp/account";
const ENTRY_SUB_SK: &str = "sub_sk";
const ENTRY_SUB_PUB: &str = "sub_pub";
const ENTRY_STATE_KEY: &str = "state_key";
const ENTRY_CURRENT: &str = "current";

fn account_service(account_pub: &str) -> String {
    format!("{}/{}", SERVICE_ROOT, account_pub)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredAccount {
    pub account_pub: String,
    pub sub_pub: String,
    pub sub_sk_b64: String,
    pub state_key_b64: String,
}

pub fn save_account(a: &StoredAccount) -> Result<(), keyring::Error> {
    let svc = account_service(&a.account_pub);
    Entry::new(&svc, ENTRY_SUB_SK)?.set_password(&a.sub_sk_b64)?;
    Entry::new(&svc, ENTRY_SUB_PUB)?.set_password(&a.sub_pub)?;
    Entry::new(&svc, ENTRY_STATE_KEY)?.set_password(&a.state_key_b64)?;
    Entry::new(SERVICE_ROOT, ENTRY_CURRENT)?.set_password(&a.account_pub)?;
    Ok(())
}

pub fn load_account(account_pub: &str) -> Result<StoredAccount, keyring::Error> {
    let svc = account_service(account_pub);
    Ok(StoredAccount {
        account_pub: account_pub.to_string(),
        sub_pub: Entry::new(&svc, ENTRY_SUB_PUB)?.get_password()?,
        sub_sk_b64: Entry::new(&svc, ENTRY_SUB_SK)?.get_password()?,
        state_key_b64: Entry::new(&svc, ENTRY_STATE_KEY)?.get_password()?,
    })
}

pub fn load_account_opt(account_pub: &str) -> Result<Option<StoredAccount>, keyring::Error> {
    match load_account(account_pub) {
        Ok(a) => Ok(Some(a)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn current_account_pub() -> Result<Option<String>, keyring::Error> {
    match Entry::new(SERVICE_ROOT, ENTRY_CURRENT)?.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn delete_account(account_pub: &str) -> Result<(), keyring::Error> {
    let svc = account_service(account_pub);
    let _ = Entry::new(&svc, ENTRY_SUB_SK)?.delete_credential();
    let _ = Entry::new(&svc, ENTRY_SUB_PUB)?.delete_credential();
    let _ = Entry::new(&svc, ENTRY_STATE_KEY)?.delete_credential();
    if let Ok(Some(cur)) = current_account_pub() {
        if cur == account_pub {
            let _ = Entry::new(SERVICE_ROOT, ENTRY_CURRENT)?.delete_credential();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // keyring::mock uses CredentialPersistence::EntryOnly — each Entry::new()
    // call produces a fresh independent in-memory store, so data written via
    // one Entry object is not visible through a subsequently constructed Entry
    // with the same service/user keys.  A full roundtrip test therefore
    // requires the real OS keychain and is skipped here; it is covered by the
    // TypeScript e2e suite in Task 12 which exercises the live Tauri commands.

    #[test]
    fn load_missing_account_returns_none() {
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        let got = load_account_opt("does-not-exist").expect("ok");
        assert!(got.is_none());
    }
}
