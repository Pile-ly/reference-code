// `POST /echo` — the body and its `Content-Type`, unchanged.

use axum::body::Bytes;
use axum::http::{header::CONTENT_TYPE, HeaderMap, HeaderValue};
use axum::response::{IntoResponse, Response};

pub struct Echo;

impl Echo {
    /// A missing `Content-Type` echoes back as `application/octet-stream`,
    /// the same default a client would assume for an untyped body.
    pub async fn handler(headers: HeaderMap, body: Bytes) -> Response {
        let content_type = headers
            .get(CONTENT_TYPE)
            .cloned()
            .unwrap_or_else(|| HeaderValue::from_static("application/octet-stream"));
        let mut response = body.into_response();
        response.headers_mut().insert(CONTENT_TYPE, content_type);
        response
    }
}
