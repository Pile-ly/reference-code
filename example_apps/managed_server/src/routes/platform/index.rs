// `GET /platform` — this server spending its own backend token at one of
// the platform's `simple-*` hosts, to prove the credential actually works
// end to end. Answers the owner's app list from `simple-db.pilely.app`.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use serde::Serialize;
use serde_json::Value;

use crate::state::AppState;

/// The upstream URL is fixed, not configurable: this route exists to prove
/// the ONE credential works at the ONE host family it is minted for, not
/// to be a general-purpose proxy.
const SIMPLE_DB_APPS_LIST_URL: &str = "https://simple-db.pilely.app/apps/list";

/// `{status, body}` — the upstream's own status and body, carried through
/// verbatim. This route never interprets the upstream's answer; a caller
/// wanting to know whether the token was ACCEPTED reads `status` itself
/// (401 means no, everything else means the platform recognized it).
#[derive(Serialize)]
struct PlatformResponse {
    status: u16,
    body: Value,
}

pub struct Platform;

impl Platform {
    /// With no backend token (a local `cargo run`, or any box whose
    /// `launch.json` never carried one), answers `503` rather than making
    /// a call that could only ever fail — the caller learns immediately
    /// that this box has no credential, instead of waiting on a doomed
    /// request.
    pub async fn handler(State(state): State<AppState>) -> Response {
        let Some(token) = &state.backend_token else {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({ "error": "no_backend_token" })),
            )
                .into_response();
        };

        let outcome = state
            .http_client
            .post(SIMPLE_DB_APPS_LIST_URL)
            .bearer_auth(token.as_ref())
            .header("Accept", "application/json")
            .json(&serde_json::json!({}))
            .send()
            .await;

        match outcome {
            Ok(resp) => {
                let status = resp.status().as_u16();
                let text = resp.text().await.unwrap_or_default();
                // The upstream always answers JSON; fall back to the raw
                // text as a JSON string only if it somehow did not, so a
                // malformed upstream body still comes back as SOMETHING
                // rather than dropping the response entirely.
                let body: Value =
                    serde_json::from_str(&text).unwrap_or_else(|_| Value::String(text));
                Json(PlatformResponse { status, body }).into_response()
            }
            // A transport failure (DNS, connect, TLS, timeout) — never a
            // panic, never a hang; the caller gets a normal error response
            // instead, with no connection detail echoed into the body.
            Err(_) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({ "error": "upstream_unreachable" })),
            )
                .into_response(),
        }
    }
}

#[cfg(test)]
#[path = "index_test.rs"]
mod index_test;
