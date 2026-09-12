use std::env;

/// Process-lifetime configuration read once at startup. `PORT` is
/// required — there is deliberately no default, because a silent fallback
/// is how a managed box ends up serving on the wrong port. `server_id` and
/// `app_version` are optional: they only exist once a box's `launch.json`
/// sets them as `app_env`, so a local `cargo run` never has them.
#[derive(Debug)]
pub struct Config {
    pub port: u16,
    pub server_id: Option<String>,
    pub app_version: Option<String>,
}

/// The one way `PORT` fails to parse into a `Config`.
#[derive(Debug, PartialEq, Eq)]
pub enum ConfigError {
    PortMissing,
    PortInvalid(String),
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConfigError::PortMissing => write!(f, "PORT is required and has no default"),
            ConfigError::PortInvalid(value) => {
                write!(f, "PORT={value:?} is not a valid u16")
            }
        }
    }
}

impl std::error::Error for ConfigError {}

impl Config {
    /// Reads `PORT` (required), `SIMPLE_SERVER_ID` and `APP_VERSION`
    /// (optional, `None` when unset or empty) from the process environment.
    pub fn from_env() -> Result<Self, ConfigError> {
        let port_raw = env::var("PORT").map_err(|_| ConfigError::PortMissing)?;
        let port = port_raw
            .parse::<u16>()
            .map_err(|_| ConfigError::PortInvalid(port_raw))?;
        Ok(Config {
            port,
            server_id: Self::non_empty_env("SIMPLE_SERVER_ID"),
            app_version: Self::non_empty_env("APP_VERSION"),
        })
    }

    fn non_empty_env(key: &str) -> Option<String> {
        env::var(key).ok().filter(|v| !v.is_empty())
    }
}

#[cfg(test)]
#[path = "config_test.rs"]
mod config_test;
