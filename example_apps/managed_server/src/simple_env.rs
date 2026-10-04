// Loading this box's env set from `@simple_env` at boot. A box launched
// with `server/add {env_id}` gets `SIMPLE_ENV_ID` in its `app_env`; it
// reads the set ONCE, before binding, with its own `PILELY_BACKEND_TOKEN`.
// The read succeeds only while the app is an `app` member of the set's
// `read_group` — anything else is a boot failure, never a silent empty env.

use serde_json::{Map, Value};

/// The service's public host. Fixed, like `GET /platform`'s upstream: the
/// backend token is minted for the platform's `simple-*` hosts only.
const SIMPLE_ENV_ORIGIN: &str = "https://simple-env.pilely.app";

/// The set's stored object, `{KEY: VALUE, ...}` — values are any JSON.
pub type EnvMap = Map<String, Value>;

/// Why the boot read failed. Never carries a value from the set.
#[derive(Debug, PartialEq, Eq)]
pub enum LoadEnvError {
    /// `SIMPLE_ENV_ID` is set but `PILELY_BACKEND_TOKEN` is not.
    NoBackendToken,
    /// DNS, connect, TLS or timeout — no status to report.
    Unreachable,
    /// A non-200 answer: the status and the refusal's `code`, when the
    /// body carried one (`404 not_found` = not in the `read_group`).
    Refused { status: u16, code: Option<String> },
    /// A 200 whose body is not a JSON object.
    NotAnObject,
}

impl std::fmt::Display for LoadEnvError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LoadEnvError::NoBackendToken => {
                write!(f, "SIMPLE_ENV_ID is set but PILELY_BACKEND_TOKEN is not")
            }
            LoadEnvError::Unreachable => write!(f, "simple-env.pilely.app is unreachable"),
            LoadEnvError::Refused { status, code } => match code {
                Some(code) => write!(f, "simple-env answered {status} {code}"),
                None => write!(f, "simple-env answered {status}"),
            },
            LoadEnvError::NotAnObject => write!(f, "simple-env answered 200 without a JSON object"),
        }
    }
}

impl std::error::Error for LoadEnvError {}

pub struct SimpleEnv;

impl SimpleEnv {
    /// `POST <origin>/<env_id>/get` with the backend token as the Bearer.
    /// The answer is the bare stored object — no `ok` envelope.
    pub async fn load(
        client: &reqwest::Client,
        env_id: &str,
        backend_token: Option<&str>,
    ) -> Result<EnvMap, LoadEnvError> {
        let token = backend_token.ok_or(LoadEnvError::NoBackendToken)?;
        let resp = client
            .post(format!("{SIMPLE_ENV_ORIGIN}/{env_id}/get"))
            .bearer_auth(token)
            .header("Accept", "application/json")
            .json(&serde_json::json!({}))
            .send()
            .await
            .map_err(|_| LoadEnvError::Unreachable)?;
        let status = resp.status().as_u16();
        let text = resp.text().await.map_err(|_| LoadEnvError::Unreachable)?;
        Self::parse(status, &text)
    }

    /// The answer → the env, or why boot must stop. Split out of `load`
    /// so the decision is testable without a network.
    pub fn parse(status: u16, body: &str) -> Result<EnvMap, LoadEnvError> {
        let json: Option<Value> = serde_json::from_str(body).ok();
        if status != 200 {
            let code = json
                .as_ref()
                .and_then(|v| v.get("code"))
                .and_then(Value::as_str)
                .map(str::to_owned);
            return Err(LoadEnvError::Refused { status, code });
        }
        match json {
            Some(Value::Object(map)) => Ok(map),
            _ => Err(LoadEnvError::NotAnObject),
        }
    }
}

#[cfg(test)]
#[path = "simple_env_test.rs"]
mod simple_env_test;
