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
    /// This server's own outbound credential at the platform's `simple-*`
    /// hosts (identifies THIS server of THIS app, acting as the owner
    /// through the app — never a user). Set by a managed box's
    /// `launch.json` as `PILELY_BACKEND_TOKEN`; `None` on a local
    /// `cargo run`, and `GET /platform` answers `503` for exactly that
    /// case.
    pub backend_token: Option<String>,
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
            backend_token: Self::non_empty_env("PILELY_BACKEND_TOKEN"),
        })
    }

    fn non_empty_env(key: &str) -> Option<String> {
        env::var(key).ok().filter(|v| !v.is_empty())
    }
}

#[cfg(test)]
#[path = "config_test.rs"]
mod config_test;
