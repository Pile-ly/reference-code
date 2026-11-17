// Handler for `GET /` — identifies the app by name, nothing else. Asked for
// markdown (`/index.md`, or `Accept: text/markdown`), it answers the app's
// manual instead: every route and how to reach its own manual.

use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};

use crate::manual::Manual;
use crate::state::APP_NAME;

pub struct Index;

impl Index {
    pub async fn handler(headers: HeaderMap) -> Response {
        if Manual::wanted(&headers) {
            return Manual::respond(&Self::manual());
        }
        format!("hello from {APP_NAME}").into_response()
    }

    fn manual() -> String {
        format!(
            "# {APP_NAME}

The managed-server reference app. Append `.md` to a `GET` route below to read its manual; without it, the route answers plain text or JSON.

| route | answers |
| --- | --- |
| `GET /` | the app's name as plain text; this manual at `/index.md` |
| `GET /whoami` | the caller's forwarded identity as JSON `{{entity, app}}`; its manual at `/whoami.md` |
| `POST /echo` | the request body back, with its `Content-Type` |
| `GET /which` | `{{server_id, version}}` of the box that answered, as JSON |
| `GET /notes` | every note held, oldest first, as a JSON array of strings |
| `POST /notes` | appends the raw UTF-8 body as one note (`201`; `400` not UTF-8; `413` over 4 KiB) |
| `GET /platform` | this server's backend token spent at `simple-db.pilely.app/apps/list`, as `{{status, body}}` |
| `ANY /webhooks`, `ANY /webhooks/...` | every request header received, as a JSON object of lowercased name to value |
"
        )
    }
}
