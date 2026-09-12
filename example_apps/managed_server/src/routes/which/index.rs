// `GET /which` — which box and which build answered, so a multi-server app
// can tell its instances apart.

use axum::extract::State;
use axum::response::Json;
use serde::Serialize;

use crate::state::AppState;

/// The response body: both fields `null` for whichever env var a local run
/// never set.
#[derive(Serialize)]
pub struct WhichBody {
    server_id: Option<String>,
    version: Option<String>,
}

pub struct Which;

impl Which {
    /// `SIMPLE_SERVER_ID` / `APP_VERSION` as read at startup.
    pub async fn handler(State(state): State<AppState>) -> Json<WhichBody> {
        Json(WhichBody {
            server_id: state.server_id.map(|s| s.to_string()),
            version: state.app_version.map(|s| s.to_string()),
        })
    }
}
