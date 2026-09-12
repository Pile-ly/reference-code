use super::*;
use axum::{body::Body, http::StatusCode, routing::get};
use std::sync::{Arc, Mutex};
use tower::ServiceExt;

async fn ok() -> &'static str {
    "ok"
}

fn test_router() -> Router {
    let router = Router::new()
        .route("/healthz", get(ok))
        .route("/", get(ok));
    RequestLog::attach(router)
}

/// A minimal `tracing::Subscriber` that just counts `on_event` calls and
/// records the last event's message. Enough to prove "one line per
/// request, healthz excepted" without pulling in `tracing-subscriber` (a
/// runtime dependency, not a test one) as a test-only capture harness.
struct CountingSubscriber {
    count: Arc<Mutex<usize>>,
}

impl tracing::Subscriber for CountingSubscriber {
    fn enabled(&self, _metadata: &tracing::Metadata<'_>) -> bool {
        true
    }
    fn new_span(&self, _span: &tracing::span::Attributes<'_>) -> tracing::span::Id {
        tracing::span::Id::from_u64(1)
    }
    fn record(&self, _span: &tracing::span::Id, _values: &tracing::span::Record<'_>) {}
    fn record_follows_from(&self, _span: &tracing::span::Id, _follows: &tracing::span::Id) {}
    fn event(&self, _event: &tracing::Event<'_>) {
        *self.count.lock().unwrap() += 1;
    }
    fn enter(&self, _span: &tracing::span::Id) {}
    fn exit(&self, _span: &tracing::span::Id) {}
}

#[tokio::test]
async fn healthz_is_never_logged() {
    let count = Arc::new(Mutex::new(0));
    let subscriber = CountingSubscriber {
        count: count.clone(),
    };
    let _guard = tracing::subscriber::set_default(subscriber);

    let response = test_router()
        .oneshot(
            axum::http::Request::builder()
                .uri("/healthz")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(*count.lock().unwrap(), 0);
}

#[tokio::test]
async fn every_other_route_logs_exactly_one_line() {
    let count = Arc::new(Mutex::new(0));
    let subscriber = CountingSubscriber {
        count: count.clone(),
    };
    let _guard = tracing::subscriber::set_default(subscriber);

    let response = test_router()
        .oneshot(
            axum::http::Request::builder()
                .uri("/")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(*count.lock().unwrap(), 1);
}
