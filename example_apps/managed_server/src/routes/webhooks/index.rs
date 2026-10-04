// Any method on `/webhooks` and every path below it — the request headers
// this box received, as one JSON object. It is the header echo the
// platform's live proof reads back: which of the caller's headers root
// forwarded to an owner backend (a webhook sender's `Stripe-Signature`,
// `CF-Connecting-IP`) and which it dropped (`Authorization`, `Cookie`).
//
// It answers whether or not any `X-Pile-Requester-*` identity is present:
// a tokenless webhook sender is an anonymous caller, a normal case.

use std::collections::BTreeMap;

use axum::http::HeaderMap;
use axum::response::{IntoResponse, Json, Response};

pub struct Webhooks;

impl Webhooks {
    pub async fn handler(headers: HeaderMap) -> Response {
        Json(Self::received(&headers)).into_response()
    }

    /// Every header name (already lowercase in `HeaderMap`) mapped to its
    /// value. A header sent more than once joins its values with `", "`, the
    /// way HTTP folds a repeated field; a value that is not valid UTF-8 is
    /// decoded lossily rather than dropped, so the echo never hides a header.
    fn received(headers: &HeaderMap) -> BTreeMap<String, String> {
        let mut received: BTreeMap<String, String> = BTreeMap::new();
        for (name, value) in headers {
            let value = String::from_utf8_lossy(value.as_bytes());
            received
                .entry(name.as_str().to_owned())
                .and_modify(|joined| {
                    joined.push_str(", ");
                    joined.push_str(&value);
                })
                .or_insert_with(|| value.into_owned());
        }
        received
    }
}
