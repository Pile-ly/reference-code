use super::*;
use axum::http::HeaderValue;

#[test]
fn all_null_when_no_headers_are_present() {
    let headers = HeaderMap::new();
    assert_eq!(
        Requester::from_headers(&headers),
        Requester {
            user_id: None,
            handle: None,
            app_id: None,
        }
    );
}

#[test]
fn reads_every_forwarded_identity_header() {
    let mut headers = HeaderMap::new();
    headers.insert("x-pile-requester-user-id", HeaderValue::from_static("u_1"));
    headers.insert("x-pile-requester-handle", HeaderValue::from_static("lxhao403"));
    headers.insert("x-pile-requester-app-id", HeaderValue::from_static("app_1"));
    assert_eq!(
        Requester::from_headers(&headers),
        Requester {
            user_id: Some("u_1".to_string()),
            handle: Some("lxhao403".to_string()),
            app_id: Some("app_1".to_string()),
        }
    );
}

#[test]
fn a_partial_set_leaves_the_rest_null() {
    let mut headers = HeaderMap::new();
    headers.insert("x-pile-requester-handle", HeaderValue::from_static("lxhao403"));
    let requester = Requester::from_headers(&headers);
    assert_eq!(requester.handle, Some("lxhao403".to_string()));
    assert_eq!(requester.user_id, None);
    assert_eq!(requester.app_id, None);
}
