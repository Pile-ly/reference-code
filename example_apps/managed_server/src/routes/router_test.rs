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
        None,
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
async fn whoami_is_all_null_with_no_platform_in_front() {
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
    assert_eq!(json, serde_json::json!({ "entity": null, "app": null }));
}

#[tokio::test]
async fn whoami_reads_the_forwarded_identity_headers() {
    let response = router_with_state(None, None)
        .oneshot(
            Request::builder()
                .uri("/whoami")
                .header(
                    "X-Pile-Requester-Entity",
                    "user:7c1e4b2a-5d3f-4a8e-9b21-0f6d2c8e1a47",
                )
                .header(
                    "X-Pile-Requester-App",
                    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = body_bytes(response).await;
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        json,
        serde_json::json!({
            "entity": "user:7c1e4b2a-5d3f-4a8e-9b21-0f6d2c8e1a47",
            "app": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        })
    );
}

async fn markdown_body(response: Response) -> String {
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get("content-type").unwrap(),
        "text/markdown; charset=utf-8"
    );
    String::from_utf8(body_bytes(response).await).unwrap()
}

#[tokio::test]
async fn whoami_md_answers_the_whoami_manual() {
    let response = router_with_state(None, None)
        .oneshot(
            Request::builder()
                .uri("/whoami.md")
                .header("Accept", "application/json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = markdown_body(response).await;
    assert!(body.starts_with("# GET /whoami\n"), "{body}");
    assert!(body.contains("https://pilely.app/README.md"));
}

#[tokio::test]
async fn whoami_with_a_markdown_accept_answers_the_same_manual_as_whoami_md() {
    let router = router_with_state(None, None);
    let by_suffix = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/whoami.md")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let by_accept = router
        .oneshot(
            Request::builder()
                .uri("/whoami")
                .header("Accept", "text/markdown")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(markdown_body(by_suffix).await, markdown_body(by_accept).await);
}

#[tokio::test]
async fn index_md_answers_the_app_manual() {
    let response = router_with_state(None, None)
        .oneshot(
            Request::builder()
                .uri("/index.md")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = markdown_body(response).await;
    assert!(body.starts_with("# managed-server-reference\n"), "{body}");
    assert!(body.contains("`GET /whoami`"));
    assert!(body.contains("https://pilely.app/README.md"));
}

#[tokio::test]
async fn a_md_suffix_on_a_json_only_route_reaches_the_same_handler() {
    let response = router_with_state(Some("srv_abc"), Some("3"))
        .oneshot(
            Request::builder()
                .uri("/which.md?x=1")
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
        serde_json::json!({ "server_id": "srv_abc", "version": "3" })
    );
}

#[tokio::test]
async fn a_post_to_a_md_path_reaches_the_bare_paths_handler() {
    let response = router_with_state(None, None)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/echo.md")
                .header("Content-Type", "text/plain")
                .body(Body::from("via md"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_bytes(response).await, b"via md".to_vec());
}

#[tokio::test]
async fn a_md_in_a_middle_segment_is_not_a_suffix() {
    let response = router_with_state(None, None)
        .oneshot(
            Request::builder()
                .uri("/whoami.md/x")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
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

async fn json_body(response: Response) -> serde_json::Value {
    assert_eq!(response.status(), StatusCode::OK);
    serde_json::from_slice(&body_bytes(response).await).unwrap()
}

#[tokio::test]
async fn webhooks_echoes_every_header_an_anonymous_post_below_it_carried() {
    let response = router_with_state(None, None)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/webhooks/x")
                .header("Stripe-Signature", "t=1,v1=abc")
                .header("CF-Connecting-IP", "203.0.113.9")
                .header("Content-Type", "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    let json = json_body(response).await;
    assert_eq!(json["stripe-signature"], "t=1,v1=abc");
    assert_eq!(json["cf-connecting-ip"], "203.0.113.9");
    assert_eq!(json["content-type"], "application/json");
    assert!(json.get("x-pile-requester-entity").is_none());
}

#[tokio::test]
async fn webhooks_answers_any_method_on_the_bare_path_and_deeper_paths() {
    let router = router_with_state(None, None);
    for (method, uri) in [
        ("GET", "/webhooks"),
        ("PUT", "/webhooks/a/b/c"),
        ("DELETE", "/webhooks/stripe"),
    ] {
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(uri)
                    .header("X-Custom", "v")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(json_body(response).await["x-custom"], "v", "{method} {uri}");
    }
}

#[tokio::test]
async fn webhooks_echoes_forwarded_identity_and_joins_repeated_headers() {
    let response = router_with_state(None, None)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/webhooks")
                .header("X-Pile-Requester-Entity", "anonymous")
                .header(
                    "X-Pile-Requester-App",
                    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                )
                .header("X-Repeat", "one")
                .header("X-Repeat", "two")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let json = json_body(response).await;
    assert_eq!(json["x-pile-requester-entity"], "anonymous");
    assert_eq!(
        json["x-pile-requester-app"],
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    );
    assert_eq!(json["x-repeat"], "one, two");
}

#[tokio::test]
async fn a_path_that_only_starts_with_webhooks_is_not_the_echo() {
    let response = router_with_state(None, None)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/webhooksx")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}
