use axum::http::HeaderMap;
use serde::Serialize;

/// `GET /whoami`'s answer. Both fields are the platform's forwarded
/// identity, verbatim — this app trusts `X-Pile-Requester-Entity` and
/// `X-Pile-Requester-App` the way every managed app must: those two headers
/// are the only identity a managed box ever sees, and it never re-derives
/// or double-checks them.
///
/// `entity` is `user:<uuid>`, `app:<uuid>` or `anonymous` (an agent's
/// token reaches a user backend as no token, so `anonymous`); `app` is the
/// pile uuid of the app the entity was authenticated on.
#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct Requester {
    pub entity: Option<String>,
    pub app: Option<String>,
}

impl Requester {
    /// The forwarded-identity header naming who is calling.
    pub const ENTITY: &'static str = "x-pile-requester-entity";
    /// The forwarded-identity header naming the app they called through.
    pub const APP: &'static str = "x-pile-requester-app";

    /// Reads the two forwarded-identity headers. A header that is absent,
    /// or present but not valid UTF-8, comes back `None` — never an error:
    /// through the platform both always arrive, and a local `cargo run`
    /// with no platform in front is a normal caller here, not a failure.
    pub fn from_headers(headers: &HeaderMap) -> Self {
        Requester {
            entity: Self::header_str(headers, Self::ENTITY),
            app: Self::header_str(headers, Self::APP),
        }
    }

    fn header_str(headers: &HeaderMap, name: &str) -> Option<String> {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned)
    }
}

#[cfg(test)]
#[path = "requester_test.rs"]
mod requester_test;
