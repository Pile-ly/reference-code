// `GET /whoami` — the platform's forwarded identity, verbatim. Every field
// is `null` for an anonymous or non-app-scoped caller: the app trusts the
// three requester headers and never infers identity from anything else.
// Asked for markdown (`/whoami.md`, or `Accept: text/markdown`), it answers
// the route's manual instead of the JSON.

use axum::http::HeaderMap;
use axum::response::{IntoResponse, Json, Response};

use crate::manual::Manual;
use crate::requester::Requester;

const MANUAL: &str = "# GET /whoami

Answers who the platform says is calling, as JSON: `{\"user_id\": ..., \"handle\": ..., \"app_id\": ...}`. Each field is read verbatim from the `X-Pile-Requester-User-Id`, `X-Pile-Requester-Handle` and `X-Pile-Requester-App-Id` headers the platform forwards, and is `null` when that header is absent — an anonymous caller gets all three `null`.
";

pub struct Whoami;

impl Whoami {
    pub async fn handler(headers: HeaderMap) -> Response {
        if Manual::wanted(&headers) {
            return Manual::respond(MANUAL);
        }
        Json(Requester::from_headers(&headers)).into_response()
    }
}
