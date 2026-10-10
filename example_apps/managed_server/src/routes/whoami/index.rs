// `GET /whoami` — the platform's forwarded identity, verbatim. Both fields
// come from the two requester headers the platform stamps on every request;
// the app trusts them and never infers identity from anything else.
// Asked for markdown (`/whoami.md`, or `Accept: text/markdown`), it answers
// the route's manual instead of the JSON.

use axum::http::HeaderMap;
use axum::response::{IntoResponse, Json, Response};

use crate::manual::Manual;
use crate::requester::Requester;

const MANUAL: &str = "# GET /whoami

Answers who the platform says is calling, as JSON: `{\"entity\": ..., \"app\": ...}`. `entity` is read verbatim from `X-Pile-Requester-Entity` (`user:<uuid>`, `app:<uuid>` or `anonymous`; an agent's token arrives as no token, so `anonymous`) and `app` from `X-Pile-Requester-App` (the pile uuid of the app the caller was authenticated on). The platform sends both on every request — a signed-out caller gets `{\"entity\": \"anonymous\", \"app\": \"<this app's pile uuid>\"}`. A field is `null` only when its header is absent, which happens only with no platform in front (a local `cargo run`).
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
