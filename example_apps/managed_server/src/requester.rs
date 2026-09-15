use axum::http::HeaderMap;
use serde::Serialize;

/// `GET /whoami`'s answer. Every field is the platform's forwarded
/// identity, verbatim — this app trusts `X-Pile-Requester-*` the way every
/// managed app must: those headers are the only identity a managed box
/// ever sees, and it never re-derives or double-checks them.
#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct Requester {
    pub user_id: Option<String>,
    pub handle: Option<String>,
    pub app_id: Option<String>,
}

impl Requester {
    /// Reads the three forwarded-identity headers. A header that is absent,
    /// or present but not valid UTF-8, comes back `None` — never an error:
    /// an anonymous caller is a normal caller here, not a failure.
    pub fn from_headers(headers: &HeaderMap) -> Self {
        Requester {
            user_id: Self::header_str(headers, "x-pile-requester-user-id"),
            handle: Self::header_str(headers, "x-pile-requester-handle"),
            app_id: Self::header_str(headers, "x-pile-requester-app-id"),
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
