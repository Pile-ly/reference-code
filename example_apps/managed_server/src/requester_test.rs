use super::*;
use axum::http::HeaderValue;

#[test]
fn all_null_when_no_headers_are_present() {
    let headers = HeaderMap::new();
    assert_eq!(
        Requester::from_headers(&headers),
        Requester {
            entity: None,
            app: None,
        }
    );
}

#[test]
fn reads_both_forwarded_identity_headers() {
    let mut headers = HeaderMap::new();
    headers.insert(
        "x-pile-requester-entity",
        HeaderValue::from_static("user:7c1e4b2a-5d3f-4a8e-9b21-0f6d2c8e1a47"),
    );
    headers.insert(
        "x-pile-requester-app",
        HeaderValue::from_static("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    );
    assert_eq!(
        Requester::from_headers(&headers),
        Requester {
            entity: Some("user:7c1e4b2a-5d3f-4a8e-9b21-0f6d2c8e1a47".to_string()),
            app: Some("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".to_string()),
        }
    );
}

#[test]
fn an_anonymous_caller_is_read_verbatim() {
    let mut headers = HeaderMap::new();
    headers.insert(
        "x-pile-requester-entity",
        HeaderValue::from_static("anonymous"),
    );
    headers.insert(
        "x-pile-requester-app",
        HeaderValue::from_static("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    );
    let requester = Requester::from_headers(&headers);
    assert_eq!(requester.entity, Some("anonymous".to_string()));
    assert_eq!(
        requester.app,
        Some("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".to_string())
    );
}

#[test]
fn a_partial_set_leaves_the_other_null() {
    let mut headers = HeaderMap::new();
    headers.insert(
        "x-pile-requester-entity",
        HeaderValue::from_static("anonymous"),
    );
    let requester = Requester::from_headers(&headers);
    assert_eq!(requester.entity, Some("anonymous".to_string()));
    assert_eq!(requester.app, None);
}

#[test]
fn no_other_header_is_read_as_identity() {
    let mut headers = HeaderMap::new();
    headers.insert(
        "x-pile-original-host",
        HeaderValue::from_static("bwkm1ddy.pilely.app"),
    );
    headers.insert(
        "x-pile-requester-entity-hint",
        HeaderValue::from_static("user:u_1"),
    );
    assert_eq!(
        Requester::from_headers(&headers),
        Requester {
            entity: None,
            app: None,
        }
    );
}
