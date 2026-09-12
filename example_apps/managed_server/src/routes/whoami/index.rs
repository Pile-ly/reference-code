// `GET /whoami` — the platform's forwarded identity, verbatim. Every field
// is `null` for an anonymous or non-app-scoped caller: the app trusts the
// three requester headers and never infers identity from anything else.

use axum::http::HeaderMap;
use axum::response::Json;

use crate::requester::Requester;

pub struct Whoami;

impl Whoami {
    pub async fn handler(headers: HeaderMap) -> Json<Requester> {
        Json(Requester::from_headers(&headers))
    }
}
