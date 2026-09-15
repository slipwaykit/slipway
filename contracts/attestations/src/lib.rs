//! On-chain record of Slipway corridor quote snapshots.
//!
//! The backend poller quotes every corridor on a schedule. This contract keeps
//! the most recent 100 of those results per corridor, so anyone can check what
//! an adapter actually quoted without trusting Slipway's database.
//!
//! Amounts are `i128` fixed point with 7 decimal places, the Stellar
//! convention. Never floats. Only the admin writes; reads are open.
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, Address,
    Env, Symbol, Vec,
};

/// Entries kept per corridor. Older entries are dropped as new ones arrive.
pub const HISTORY_CAP: u32 = 100;

/// One adapter's quote on one corridor at one moment.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Attestation {
    /// Which adapter answered, e.g. `mock_ng`.
    pub adapter_id: Symbol,
    /// Which corridor it quoted, e.g. `NG_NGN`.
    pub corridor: Symbol,
    /// Notional sold, 7 decimal places.
    pub sell_amount: i128,
    /// What would have landed, 7 decimal places. Zero for a failure.
    pub landed_amount: i128,
    /// How long the quote took.
    pub latency_ms: u32,
    /// Whether the adapter answered.
    pub success: bool,
    /// Ledger close time. Set by the contract; any caller-supplied value is ignored.
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    History(Symbol),
}

/// Why a call was refused.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// `initialize` was called on a contract that already has an admin.
    AlreadyInitialized = 1,
    /// A write was attempted before `initialize`.
    NotInitialized = 2,
    /// The caller is not the admin.
    Unauthorized = 3,
    /// An amount was negative, or nothing was sold.
    InvalidAmount = 4,
}

/// Published on every write, topics `("attest", corridor)`.
#[contractevent(topics = ["attest"], data_format = "single-value")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttestEvent {
    #[topic]
    pub corridor: Symbol,
    pub attestation: Attestation,
}

#[contract]
pub struct Attestations;

#[contractimpl]
impl Attestations {
    /// Set the only address allowed to write. Panics if already initialised.
    pub fn initialize(env: Env, admin: Address) {
        let storage = env.storage().instance();
        if storage.has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        storage.set(&DataKey::Admin, &admin);
        let max = env.storage().max_ttl();
        storage.extend_ttl(max, max);
    }

    /// Append an attestation to its corridor's history. Admin only.
    pub fn attest(env: Env, admin: Address, a: Attestation) {
        admin.require_auth();

        let instance = env.storage().instance();
        let stored: Address = instance
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        if stored != admin {
            panic_with_error!(&env, Error::Unauthorized);
        }
        if a.sell_amount <= 0 || a.landed_amount < 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }

        // The ledger, not the caller, says when this happened.
        let mut entry = a;
        entry.timestamp = env.ledger().timestamp();

        let key = DataKey::History(entry.corridor.clone());
        let persistent = env.storage().persistent();
        let mut history: Vec<Attestation> = persistent.get(&key).unwrap_or_else(|| Vec::new(&env));
        while history.len() >= HISTORY_CAP {
            history.pop_front();
        }
        history.push_back(entry.clone());
        persistent.set(&key, &history);

        // Extend on every write so an active corridor is never archived.
        let max = env.storage().max_ttl();
        persistent.extend_ttl(&key, max, max);
        instance.extend_ttl(max, max);

        AttestEvent {
            corridor: entry.corridor.clone(),
            attestation: entry,
        }
        .publish(&env);
    }

    /// Every stored attestation for a corridor, oldest first.
    pub fn history(env: Env, corridor: Symbol) -> Vec<Attestation> {
        env.storage()
            .persistent()
            .get(&DataKey::History(corridor))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// The most recent attestation from one adapter on one corridor.
    pub fn latest(env: Env, corridor: Symbol, adapter_id: Symbol) -> Option<Attestation> {
        Self::history(env, corridor)
            .iter()
            .rev()
            .find(|entry| entry.adapter_id == adapter_id)
    }
}

#[cfg(test)]
mod test;
