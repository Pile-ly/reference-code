use super::Routes;
use axum::response::Response;
use axum::Router;
use crate::state::AppState;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use tower::ServiceExt;

fn router_with_state(server_id: Option<&str>, app_version: Option<&str>) -> Router {
    Routes::router(AppState::new(
        server_id.map(str::to_owned),
        app_version.map(str::to_owned),
    ))
}

async fn body_bytes(response: Response) -> Vec<u8> {
    response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes()
        .to_vec()
}

#[tokio::test]
async fn healthz_answers_ok_with_no_auth() {
    let response = router_with_state(None, None)
        .oneshot(
            Request::builder()
                .uri("/healthz")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_bytes(response).await, b"ok");
}

#[tokio::test]
async fn root_greets_by_app_name() {
    let response = router_with_state(None, None)
        .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        body_bytes(response).await,
        b"hello from managed-server-reference".to_vec()
    );
}

#[tokio::test]
async fn whoami_is_all_null_for_an_anonymous_caller() {
    let response = router_with_state(None, None)
        .oneshot(
            Request::builder()
                .uri("/whoami")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_bytes(response).await;
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        json,
        serde_json::json!({ "user_id": null, "handle": null, "app_id": null })
    );
}

#[tokio::test]
async fn whoami_reads_the_forwarded_identity_headers() {
    let response = router_with_state(None, None)
        .oneshot(
            Request::builder()
                .uri("/whoami")
                .header("X-Pile-Requester-User-Id", "u_1")
                .header("X-Pile-Requester-Handle", "lxhao403")
                .header("X-Pile-Requester-App-Id", "app_1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = body_bytes(response).await;
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        json,
        serde_json::json!({ "user_id": "u_1", "handle": "lxhao403", "app_id": "app_1" })
    );
}

#[tokio::test]
async fn echo_returns_the_body_with_its_content_type() {
    let response = router_with_state(None, None)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/echo")
                .header("Content-Type", "text/plain")
                .body(Body::from("hello there"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get("content-type").unwrap(),
        "text/plain"
    );
    assert_eq!(body_bytes(response).await, b"hello there".to_vec());
}

#[tokio::test]
async fn echo_defaults_content_type_when_absent() {
    let response = router_with_state(None, None)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/echo")
                .body(Body::from("raw"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        response.headers().get("content-type").unwrap(),
        "application/octet-stream"
    );
}

#[tokio::test]
async fn which_is_null_when_env_was_never_set() {
    let response = router_with_state(None, None)
        .oneshot(Request::builder().uri("/which").body(Body::empty()).unwrap())
        .await
        .unwrap();
    let body = body_bytes(response).await;
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json, serde_json::json!({ "server_id": null, "version": null }));
}

#[tokio::test]
async fn which_reports_the_server_id_and_version() {
    let response = router_with_state(Some("srv_abc"), Some("3"))
        .oneshot(Request::builder().uri("/which").body(Body::empty()).unwrap())
        .await
        .unwrap();
    let body = body_bytes(response).await;
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        json,
        serde_json::json!({ "server_id": "srv_abc", "version": "3" })
    );
}

#[tokio::test]
async fn notes_round_trip_across_two_posts() {
    let router = router_with_state(None, None);

    let post_one = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/notes")
                .body(Body::from("first note"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(post_one.status(), StatusCode::CREATED);

    let post_two = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/notes")
                .body(Body::from("second note"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(post_two.status(), StatusCode::CREATED);

    let get = router
        .oneshot(Request::builder().uri("/notes").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(get.status(), StatusCode::OK);
    let body = body_bytes(get).await;
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json, serde_json::json!(["first note", "second note"]));
}

#[tokio::test]
async fn notes_get_starts_empty() {
    let response = router_with_state(None, None)
        .oneshot(Request::builder().uri("/notes").body(Body::empty()).unwrap())
        .await
        .unwrap();
    let body = body_bytes(response).await;
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json, serde_json::json!([]));
}

#[tokio::test]
async fn notes_post_rejects_non_utf8_bodies() {
    let response = router_with_state(None, None)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/notes")
                .body(Body::from(vec![0xff, 0xfe, 0xfd]))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn notes_post_rejects_bodies_over_the_byte_cap() {
    let oversized = "a".repeat(crate::state::MAX_NOTE_BYTES + 1);
    let response = router_with_state(None, None)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/notes")
                .body(Body::from(oversized))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn notes_post_accepts_a_body_at_exactly_the_byte_cap() {
    let exact = "a".repeat(crate::state::MAX_NOTE_BYTES);
    let response = router_with_state(None, None)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/notes")
                .body(Body::from(exact))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
}
