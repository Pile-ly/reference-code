// The one case this route can prove without a live network call: no
// backend token at all. The "valid token reaches simple-db" path is
// exercised only by the manual local-run proof in README.md — the
// upstream host is fixed, not configurable, so there is nothing local to
// point it at in an automated test (see this project's own "no e2e_tests"
// convention).

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use tower::ServiceExt;

use crate::routes::Routes;
use crate::state::AppState;

#[tokio::test]
async fn no_backend_token_answers_503_with_the_documented_error() {
    let router = Routes::router(AppState::new(None, None, None));
    let response = router
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/platform")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(value, serde_json::json!({ "error": "no_backend_token" }));
}
