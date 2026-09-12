use super::*;
use std::sync::Mutex;

// `std::env` is process-global, and `cargo test` runs tests in threads of
// the same process — without this, two tests setting PORT concurrently
// would read each other's value. One mutex serializes every test in this
// file; each holds it for its entire body. `set_var`/`remove_var` are
// `unsafe` since Rust 1.82 for the same underlying reason (libc getenv is
// not thread-safe against a concurrent setenv) — this lock is exactly the
// safety invariant that unsafe block is asking the caller to uphold.
static ENV_LOCK: Mutex<()> = Mutex::new(());

// A poisoned lock here means an earlier test in this file panicked while
// holding it, not that the env state itself is inconsistent (each test
// calls clear_all() before asserting anything) — recovering keeps one
// real failure from cascading into every remaining test in the file.
fn lock_env() -> std::sync::MutexGuard<'static, ()> {
    ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn clear_all() {
    unsafe {
        env::remove_var("PORT");
        env::remove_var("SIMPLE_SERVER_ID");
        env::remove_var("APP_VERSION");
    }
}

#[test]
fn missing_port_is_an_error_not_a_default() {
    let _guard = lock_env();
    clear_all();
    assert_eq!(Config::from_env().unwrap_err(), ConfigError::PortMissing);
}

#[test]
fn invalid_port_is_reported_with_the_bad_value() {
    let _guard = lock_env();
    clear_all();
    unsafe {
        env::set_var("PORT", "not-a-port");
    }
    assert_eq!(
        Config::from_env().unwrap_err(),
        ConfigError::PortInvalid("not-a-port".to_string())
    );
    clear_all();
}

#[test]
fn server_id_and_app_version_are_none_when_unset() {
    let _guard = lock_env();
    clear_all();
    unsafe {
        env::set_var("PORT", "8080");
    }
    let config = Config::from_env().unwrap();
    assert_eq!(config.port, 8080);
    assert_eq!(config.server_id, None);
    assert_eq!(config.app_version, None);
    clear_all();
}

#[test]
fn server_id_and_app_version_are_read_when_present() {
    let _guard = lock_env();
    clear_all();
    unsafe {
        env::set_var("PORT", "3000");
        env::set_var("SIMPLE_SERVER_ID", "srv_123");
        env::set_var("APP_VERSION", "7");
    }
    let config = Config::from_env().unwrap();
    assert_eq!(config.port, 3000);
    assert_eq!(config.server_id, Some("srv_123".to_string()));
    assert_eq!(config.app_version, Some("7".to_string()));
    clear_all();
}

#[test]
fn empty_optional_env_is_treated_as_absent() {
    let _guard = lock_env();
    clear_all();
    unsafe {
        env::set_var("PORT", "8080");
        env::set_var("SIMPLE_SERVER_ID", "");
    }
    let config = Config::from_env().unwrap();
    assert_eq!(config.server_id, None);
    clear_all();
}
