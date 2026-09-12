// Top-level router for the managed-server reference app.
//
// The app is a plain HTTP backend: root forwards a request to it over
// `managed_http` and it answers on `0.0.0.0:$PORT`. Nothing here knows a
// public mount prefix — the host alone identifies the app, so every path
// below is the path the caller used.
//
// What this router answers:
//   - `GET  /healthz`  liveness probe (no auth, no logging)
//   - `GET  /`         the app's name
//   - `GET  /whoami`   the platform's forwarded identity
//   - `POST /echo`     the request body and its content type
//   - `GET  /which`    which box and which build answered
//   - `GET  /notes`    the capped in-memory list
//   - `POST /notes`    append one note
//
// The folder structure mirrors this layout: `routes/index.rs` is `/`, and
// every other route is a folder named for its path segment.

use axum::routing::{get, post};
use axum::Router;

use crate::logging::RequestLog;
use crate::routes::{echo, healthz, index, notes, which, whoami};
use crate::state::AppState;

pub struct Routes;

impl Routes {
    /// Builds the full router: the seven routes this app serves, the state
    /// they share, and the one logging layer wrapping all of them.
    pub fn router(state: AppState) -> Router {
        let router = Router::new()
            .route("/healthz", get(healthz::Healthz::handler))
            .route("/", get(index::Index::handler))
            .route("/whoami", get(whoami::Whoami::handler))
            .route("/echo", post(echo::Echo::handler))
            .route("/which", get(which::Which::handler))
            .route(
                "/notes",
                get(notes::Notes::get).post(notes::Notes::post),
            )
            .with_state(state);
        RequestLog::attach(router)
    }
}

#[cfg(test)]
#[path = "router_test.rs"]
mod router_test;
