// Top-level router for the managed-server reference app.
//
// The app is a plain HTTP backend: root forwards a request to it over
// `managed_http` and it answers on `0.0.0.0:$PORT`. Nothing here knows a
// public mount prefix — the host alone identifies the app, so every path
// below is the path the caller used.
//
// What this router answers:
//   - `GET  /healthz`  liveness probe (no auth, no logging)
//   - `GET  /`         the app's name; its manual as markdown
//   - `GET  /whoami`   the platform's forwarded identity; its manual as
//                      markdown
//   - `POST /echo`     the request body and its content type
//   - `GET  /which`    which box and which build answered
//   - `GET  /notes`    the capped in-memory list
//   - `POST /notes`    append one note
//   - `GET  /platform` this server's own backend token, spent at
//                      simple-db.pilely.app
//   - `ANY  /webhooks` and every path below it — the request headers
//                      this box received, as JSON
//
// Every path also answers with a `.md` suffix (`/index.md` for `/`):
// `MdSuffix` maps `/x.md` onto `/x` + `Accept: text/markdown` before any
// route matches, so the request log records the bare path.
//
// The folder structure mirrors this layout: `routes/index.rs` is `/`, and
// every other route is a folder named for its path segment.

use axum::routing::{any, get, post};
use axum::Router;

use crate::logging::RequestLog;
use crate::md_suffix::MdSuffix;
use crate::routes::{echo, healthz, index, notes, platform, webhooks, which, whoami};
use crate::state::AppState;

pub struct Routes;

impl Routes {
    /// Builds the full router: the routes this app serves, the state
    /// they share, the one logging layer wrapping all of them, and the
    /// `.md` rewrite running before any of them matches.
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
            .route("/platform", get(platform::Platform::handler))
            .route("/webhooks", any(webhooks::Webhooks::handler))
            .route("/webhooks/{*rest}", any(webhooks::Webhooks::handler))
            .with_state(state);
        MdSuffix::attach(RequestLog::attach(router))
    }
}

#[cfg(test)]
#[path = "router_test.rs"]
mod router_test;
