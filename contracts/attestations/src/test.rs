#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{storage::Persistent as _, Address as _, Events as _, Ledger as _, MockAuth, MockAuthInvoke},
    Address, Env, Event, IntoVal, Symbol,
};

/// 7 decimal places: 100 USDC.
const HUNDRED: i128 = 1_000_000_000;

fn setup() -> (Env, AttestationsClient<'static>, Address) {
    let env = Env::default();
    env.ledger().set_timestamp(1_757_942_400);
    let id = env.register(Attestations, ());
    let client = AttestationsClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, client, admin)
}

/// Build an attestation owned by `env`, which Soroban requires for host objects.
fn at(env: &Env, adapter: &str, corridor: &str, landed: i128) -> Attestation {
    Attestation {
        adapter_id: Symbol::new(env, adapter),
        corridor: Symbol::new(env, corridor),
        sell_amount: HUNDRED,
        landed_amount: landed,
        latency_ms: 412,
        success: true,
        timestamp: 0,
    }
}

#[test]
fn initialise_attest_and_read_back() {
    let (env, client, admin) = setup();
    env.mock_all_auths();

    client.attest(&admin, &at(&env, "mock_ng", "NG_NGN", 1_575_000_000_000));

    let history = client.history(&symbol_short!("NG_NGN"));
    assert_eq!(history.len(), 1);
    let stored = history.get(0).unwrap();
    assert_eq!(stored.adapter_id, symbol_short!("mock_ng"));
    assert_eq!(stored.sell_amount, HUNDRED);
    assert_eq!(stored.landed_amount, 1_575_000_000_000);
    assert!(stored.success);
}

#[test]
fn history_is_empty_for_an_unknown_corridor() {
    let (_env, client, _admin) = setup();
    assert_eq!(client.history(&symbol_short!("KE_KES")).len(), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn initialise_twice_panics() {
    let (env, client, _admin) = setup();
    client.initialize(&Address::generate(&env));
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn rejects_a_writer_who_is_not_the_admin() {
    let (env, client, _admin) = setup();
    env.mock_all_auths();
    // The intruder signs for itself, which require_auth accepts, but it is not
    // the stored admin.
    let intruder = Address::generate(&env);
    client.attest(&intruder, &at(&env, "mock_ng", "NG_NGN", 1));
}

#[test]
fn rejects_the_admin_address_without_the_admin_signature() {
    let (env, client, admin) = setup();
    let intruder = Address::generate(&env);
    let entry = at(&env, "mock_ng", "NG_NGN", 1);

    // Only the intruder authorises; the call names the admin.
    let result = client
        .mock_auths(&[MockAuth {
            address: &intruder,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "attest",
                args: (admin.clone(), entry.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_attest(&admin, &entry);

    assert!(result.is_err());
    assert_eq!(client.history(&symbol_short!("NG_NGN")).len(), 0);
}

#[test]
fn requires_the_admin_signature() {
    let (env, client, admin) = setup();
    env.mock_all_auths();
    let entry = at(&env, "mock_ng", "NG_NGN", 1);

    client.attest(&admin, &entry);

    let auths = env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, admin);
}

#[test]
fn caps_each_corridor_at_the_most_recent_100() {
    let (env, client, admin) = setup();
    env.mock_all_auths();

    for landed in 1..=105 {
        client.attest(&admin, &at(&env, "mock_ng", "NG_NGN", landed));
    }

    let history = client.history(&symbol_short!("NG_NGN"));
    assert_eq!(history.len(), HISTORY_CAP);
    // Entries 1 to 5 were dropped; the oldest survivor is 6, the newest 105.
    assert_eq!(history.get(0).unwrap().landed_amount, 6);
    assert_eq!(history.get(99).unwrap().landed_amount, 105);
}

#[test]
fn keeps_corridors_separate() {
    let (env, client, admin) = setup();
    env.mock_all_auths();

    client.attest(&admin, &at(&env, "mock_ng", "NG_NGN", 1));
    client.attest(&admin, &at(&env, "mock_ke", "KE_KES", 2));

    assert_eq!(client.history(&symbol_short!("NG_NGN")).len(), 1);
    assert_eq!(client.history(&symbol_short!("KE_KES")).len(), 1);
}

#[test]
fn latest_returns_the_newest_entry_for_that_adapter() {
    let (env, client, admin) = setup();
    env.mock_all_auths();

    client.attest(&admin, &at(&env, "mock_ng", "NG_NGN", 1));
    client.attest(&admin, &at(&env, "sep24_x", "NG_NGN", 2));
    client.attest(&admin, &at(&env, "mock_ng", "NG_NGN", 3));

    let corridor = symbol_short!("NG_NGN");
    assert_eq!(client.latest(&corridor, &symbol_short!("mock_ng")).unwrap().landed_amount, 3);
    assert_eq!(client.latest(&corridor, &symbol_short!("sep24_x")).unwrap().landed_amount, 2);
    assert!(client.latest(&corridor, &symbol_short!("nobody")).is_none());
}

#[test]
fn the_ledger_sets_the_timestamp_not_the_caller() {
    let (env, client, admin) = setup();
    env.mock_all_auths();

    let mut forged = at(&env, "mock_ng", "NG_NGN", 1);
    forged.timestamp = 4_102_444_800; // 2100-01-01
    client.attest(&admin, &forged);

    assert_eq!(client.history(&symbol_short!("NG_NGN")).get(0).unwrap().timestamp, 1_757_942_400);
}

#[test]
fn records_a_failed_quote_with_zero_landed() {
    let (env, client, admin) = setup();
    env.mock_all_auths();

    let mut failure = at(&env, "sep24_x", "NG_NGN", 0);
    failure.success = false;
    client.attest(&admin, &failure);

    assert!(!client.history(&symbol_short!("NG_NGN")).get(0).unwrap().success);
}

#[test]
fn rejects_negative_amounts_and_empty_notional() {
    let (env, client, admin) = setup();
    env.mock_all_auths();

    let negative = at(&env, "mock_ng", "NG_NGN", -1);
    let mut nothing_sold = at(&env, "mock_ng", "NG_NGN", 1);
    nothing_sold.sell_amount = 0;

    assert!(client.try_attest(&admin, &negative).is_err());
    assert!(client.try_attest(&admin, &nothing_sold).is_err());
}

#[test]
fn publishes_an_attest_event_keyed_by_corridor() {
    let (env, client, admin) = setup();
    env.mock_all_auths();
    let entry = at(&env, "mock_ng", "NG_NGN", 7);

    client.attest(&admin, &entry);

    let mut expected = entry.clone();
    expected.timestamp = 1_757_942_400;
    let events = env.events().all();
    assert_eq!(events.events().len(), 1);
    assert_eq!(
        events,
        std::vec![AttestEvent { corridor: symbol_short!("NG_NGN"), attestation: expected }
            .to_xdr(&env, &client.address)]
    );
}

#[test]
fn extends_persistent_ttl_on_every_write() {
    let (env, client, admin) = setup();
    env.mock_all_auths();

    client.attest(&admin, &at(&env, "mock_ng", "NG_NGN", 1));
    let key = DataKey::History(symbol_short!("NG_NGN"));
    let max = env.as_contract(&client.address, || env.storage().max_ttl());
    let after_first = env.as_contract(&client.address, || env.storage().persistent().get_ttl(&key));
    assert_eq!(after_first, max);

    // Let a month of ledgers pass, then write again.
    env.ledger().with_mut(|ledger| ledger.sequence_number += 518_400);
    client.attest(&admin, &at(&env, "mock_ng", "NG_NGN", 2));
    let after_second = env.as_contract(&client.address, || env.storage().persistent().get_ttl(&key));
    assert_eq!(after_second, max);
}
