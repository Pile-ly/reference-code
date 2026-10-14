use std::time::Instant;

use axum::{extract::Request, middleware::Next, middleware::from_fn, response::Response, Router};

/// One line per request: method, path, status, elapsed milliseconds, to
/// stdout via `tracing`, and nothing else. `GET /healthz` is the standard
/// infrastructure exception — it never logs.
pub struct RequestLog;

impl RequestLog {
    /// Attaches the logging middleware to a router.
    pub fn attach(router: Router) -> Router {
        router.layer(from_fn(Self::log))
    }

    async fn log(request: Request, next: Next) -> Response {
        let method = request.method().clone();
        let path = request.uri().path().to_owned();
        let is_healthz = path == "/healthz";
        let started = Instant::now();

        let response = next.run(request).await;

        if !is_healthz {
            tracing::info!(
                method = %method,
                path = %path,
                status = response.status().as_u16(),
                ms = started.elapsed().as_millis(),
                "request"
            );
        }
        response
    }
}

#[cfg(test)]
#[path = "logging_test.rs"]
mod logging_test;
