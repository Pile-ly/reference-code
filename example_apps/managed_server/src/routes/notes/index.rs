// `GET /notes` and `POST /notes` — the capped in-memory list. The state is
// ephemeral by design: it resets on every start, which is what makes a box
// restart observable in the proof walk.

use axum::body::Bytes;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};

use crate::state::{AppState, MAX_NOTE_BYTES};

pub struct Notes;

impl Notes {
    /// `GET /notes` — every note still in the list, oldest first.
    pub async fn get(State(state): State<AppState>) -> Json<Vec<String>> {
        Json(state.notes.list())
    }

    /// `POST /notes` — the raw request body, decoded as UTF-8, becomes one
    /// note. A non-UTF-8 body is rejected rather than silently mangled; a
    /// body over `MAX_NOTE_BYTES` is rejected rather than retained
    /// forever — the entry cap alone bounds count, not memory.
    pub async fn post(State(state): State<AppState>, body: Bytes) -> Result<StatusCode, Response> {
        if body.len() > MAX_NOTE_BYTES {
            return Err((
                StatusCode::PAYLOAD_TOO_LARGE,
                Json(serde_json::json!({
                    "error": format!("note body exceeds {MAX_NOTE_BYTES} bytes"),
                })),
            )
                .into_response());
        }
        match String::from_utf8(body.to_vec()) {
            Ok(note) => {
                state.notes.push(note);
                Ok(StatusCode::CREATED)
            }
            Err(_) => Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "note body must be valid UTF-8" })),
            )
                .into_response()),
        }
    }
}
