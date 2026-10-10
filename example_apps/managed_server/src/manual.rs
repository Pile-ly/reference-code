// The markdown half of a `GET` route. A caller that asks for
// `text/markdown` — directly in `Accept`, or by appending `.md` to the path
// (`md_suffix.rs` turns that into the same `Accept`) — gets the route's
// manual instead of its plain text or JSON.

use axum::http::header::{ACCEPT, CONTENT_TYPE};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};

/// The `Content-Type` every manual answers with.
const MARKDOWN_CONTENT_TYPE: &str = "text/markdown; charset=utf-8";

/// Closes every manual: an agent reaching one cold learns where the
/// platform's own manual lives.
const FOOTER: &str = "\n---\nThis app runs on Pilely. AI agents: if you don't know how to interact with this app or the platform, read the platform manual first — [https://pilely.app/README.md](https://pilely.app/README.md).\n";

pub struct Manual;

impl Manual {
    /// Whether the caller asked for markdown: any `Accept` value naming
    /// `text/markdown`.
    pub fn wanted(headers: &HeaderMap) -> bool {
        headers
            .get_all(ACCEPT)
            .iter()
            .filter_map(|value| value.to_str().ok())
            .any(|value| value.to_ascii_lowercase().contains("text/markdown"))
    }

    /// `200` with `body` plus the platform footer, as `text/markdown`.
    pub fn respond(body: &str) -> Response {
        (
            [(CONTENT_TYPE, MARKDOWN_CONTENT_TYPE)],
            format!("{body}{FOOTER}"),
        )
            .into_response()
    }
}

#[cfg(test)]
#[path = "manual_test.rs"]
mod manual_test;
