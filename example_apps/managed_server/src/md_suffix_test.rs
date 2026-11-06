use axum::http::header::ACCEPT;
use axum::http::{Method, Request, Uri};

use super::MdSuffix;

fn request(method: Method, uri: &str, accept: Option<&str>) -> Request<()> {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(accept) = accept {
        builder = builder.header(ACCEPT, accept);
    }
    builder.body(()).unwrap()
}

fn stripped(uri: &str) -> Option<String> {
    MdSuffix::stripped_uri(&uri.parse::<Uri>().unwrap()).map(|u| u.to_string())
}

// ── strip: the three suffix shapes ──────────────────────────────────────────

#[test]
fn strip_bares_a_leaf_path() {
    assert_eq!(MdSuffix::strip("/whoami.md").as_deref(), Some("/whoami"));
    assert_eq!(MdSuffix::strip("/@alice.md").as_deref(), Some("/@alice"));
    assert_eq!(
        MdSuffix::strip("/apps/list.md").as_deref(),
        Some("/apps/list")
    );
}

#[test]
fn strip_bares_a_directory_index_to_its_trailing_slash() {
    assert_eq!(MdSuffix::strip("/index.md").as_deref(), Some("/"));
    assert_eq!(MdSuffix::strip("/apps/index.md").as_deref(), Some("/apps/"));
    assert_eq!(
        MdSuffix::strip("/@alice/index.md").as_deref(),
        Some("/@alice/")
    );
}

#[test]
fn strip_rejects_paths_without_the_suffix() {
    assert_eq!(MdSuffix::strip("/apps"), None);
    assert_eq!(MdSuffix::strip("/"), None);
    assert_eq!(MdSuffix::strip(""), None);
    // The literal `.md` alone names nothing.
    assert_eq!(MdSuffix::strip(".md"), None);
    // `index` that is not a whole segment is an ordinary leaf.
    assert_eq!(MdSuffix::strip("/reindex.md").as_deref(), Some("/reindex"));
}

#[test]
fn strip_leaves_a_middle_segment_md_alone() {
    assert_eq!(MdSuffix::strip("/a.md/b"), None);
}

// ── stripped_uri: decided on the decoded path, rewritten on the raw one ─────

#[test]
fn the_three_shapes_rewrite_the_uri() {
    assert_eq!(stripped("/index.md").as_deref(), Some("/"));
    assert_eq!(stripped("/apps/index.md").as_deref(), Some("/apps/"));
    assert_eq!(stripped("/apps/list.md").as_deref(), Some("/apps/list"));
}

#[test]
fn the_query_string_is_kept_untouched() {
    assert_eq!(
        stripped("/rows.md?cursor=abc&x=%2F").as_deref(),
        Some("/rows?cursor=abc&x=%2F")
    );
    assert_eq!(stripped("/index.md?q=a.md").as_deref(), Some("/?q=a.md"));
}

#[test]
fn a_percent_encoded_earlier_segment_keeps_its_encoding() {
    assert_eq!(
        stripped("/%40alice/My%20Report.md").as_deref(),
        Some("/%40alice/My%20Report")
    );
    assert_eq!(
        stripped("/%40alice/index.md").as_deref(),
        Some("/%40alice/")
    );
}

#[test]
fn a_non_md_path_is_untouched() {
    assert_eq!(stripped("/apps/list"), None);
    assert_eq!(stripped("/"), None);
    assert_eq!(stripped("/a.md/b"), None);
    assert_eq!(stripped("/list?format=x.md"), None);
}

#[test]
fn a_percent_encoded_dot_in_the_suffix_still_strips() {
    // `%2E` decodes to `.`, so `/foo%2Emd` names the manual of `/foo`.
    assert_eq!(stripped("/foo%2Emd").as_deref(), Some("/foo"));
    assert_eq!(stripped("/foo%2emd").as_deref(), Some("/foo"));
}

#[test]
fn an_encoded_slash_keeps_its_segment_encoded_and_strips_as_a_leaf() {
    // `%2F` must not decode to `/` (it would splice a segment), so
    // `skill%2Findex.md` is one leaf segment, stripped verbatim.
    assert_eq!(
        stripped("/skill%2Findex.md").as_deref(),
        Some("/skill%2Findex")
    );
}

#[test]
fn an_encoded_directory_before_index_md_collapses_in_raw_too() {
    assert_eq!(stripped("/sk%69ll/index.md").as_deref(), Some("/sk%69ll/"));
}

#[test]
fn a_decoded_last_segment_is_re_encoded() {
    // The last segment decoded cleanly; the bare form is re-encoded so it
    // stays a valid request target.
    assert_eq!(stripped("/notes/a%20b.md").as_deref(), Some("/notes/a%20b"));
}

// ── rewrite: path + Accept on the request itself ────────────────────────────

#[test]
fn rewrite_sets_accept_markdown_replacing_the_callers() {
    let mut req = request(Method::GET, "/apps/list.md", Some("application/json"));
    assert!(MdSuffix::rewrite(&mut req));
    assert_eq!(req.uri().path(), "/apps/list");
    assert_eq!(req.headers().get_all(ACCEPT).iter().count(), 1);
    assert_eq!(req.headers()[ACCEPT], "text/markdown");
}

#[test]
fn rewrite_sets_accept_when_the_caller_sent_none() {
    let mut req = request(Method::GET, "/index.md", None);
    assert!(MdSuffix::rewrite(&mut req));
    assert_eq!(req.uri().path(), "/");
    assert_eq!(req.headers()[ACCEPT], "text/markdown");
}

#[test]
fn rewrite_applies_to_every_method() {
    for method in [
        Method::GET,
        Method::POST,
        Method::PUT,
        Method::PATCH,
        Method::DELETE,
        Method::HEAD,
        Method::OPTIONS,
    ] {
        let mut req = request(method.clone(), "/apps/list.md?x=1", None);
        assert!(MdSuffix::rewrite(&mut req), "{method} must rewrite");
        assert_eq!(req.uri().to_string(), "/apps/list?x=1", "{method}");
        assert_eq!(req.headers()[ACCEPT], "text/markdown", "{method}");
        assert_eq!(req.method(), method);
    }
}

#[test]
fn rewrite_leaves_a_non_md_request_exactly_as_it_arrived() {
    let mut req = request(Method::POST, "/apps/list?x=1", Some("application/json"));
    assert!(!MdSuffix::rewrite(&mut req));
    assert_eq!(req.uri().to_string(), "/apps/list?x=1");
    assert_eq!(req.headers()[ACCEPT], "application/json");
}

#[test]
fn rewrite_keeps_scheme_and_authority_of_an_absolute_uri() {
    let mut req = request(Method::GET, "http://app.test/apps/list.md", None);
    assert!(MdSuffix::rewrite(&mut req));
    assert_eq!(req.uri().to_string(), "http://app.test/apps/list");
}
