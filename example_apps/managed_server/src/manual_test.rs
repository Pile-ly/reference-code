use super::*;
use axum::http::HeaderValue;
use http_body_util::BodyExt;

fn headers_with_accept(values: &[&'static str]) -> HeaderMap {
    let mut headers = HeaderMap::new();
    for value in values {
        headers.append(ACCEPT, HeaderValue::from_static(value));
    }
    headers
}

#[test]
fn markdown_accept_wants_the_manual() {
    assert!(Manual::wanted(&headers_with_accept(&["text/markdown"])));
    assert!(Manual::wanted(&headers_with_accept(&[
        "application/json, text/markdown;q=0.9"
    ])));
    assert!(Manual::wanted(&headers_with_accept(&["Text/Markdown"])));
    assert!(Manual::wanted(&headers_with_accept(&[
        "application/json",
        "text/markdown"
    ])));
}

#[test]
fn any_other_accept_does_not() {
    assert!(!Manual::wanted(&HeaderMap::new()));
    assert!(!Manual::wanted(&headers_with_accept(&["application/json"])));
    assert!(!Manual::wanted(&headers_with_accept(&["*/*"])));
}

#[tokio::test]
async fn the_manual_is_markdown_and_ends_with_the_platform_footer() {
    let response = Manual::respond("# title\n");
    assert_eq!(
        response.headers()[CONTENT_TYPE],
        "text/markdown; charset=utf-8"
    );
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let body = String::from_utf8(body.to_vec()).unwrap();
    assert!(body.starts_with("# title\n"));
    assert!(body.ends_with(FOOTER));
}
