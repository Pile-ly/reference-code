// The `.md` manual convention, owned by this app: a request for `/x.md`
// (or `/index.md`, `/x/index.md`) asks for the manual of `/x` (`/`, `/x/`).
// The platform forwards `/x.md` exactly as the caller sent it, with the
// caller's own `Accept`; this app maps it onto the bare path with
// `Accept: text/markdown` BEFORE routing, so `/x.md` reaches the same
// handler `/x` does and that handler answers its markdown manual.
//
// Decode-then-decide, rewrite-raw: the suffix decision is made on the
// percent-DECODED path (so `/foo%2Emd` counts as `.md`), and the strip is
// then applied to the RAW path so every untouched segment keeps the exact
// bytes the caller sent. Query string untouched. Every method.

use axum::body::Body;
use axum::http::header::{HeaderValue, ACCEPT};
use axum::http::uri::{PathAndQuery, Uri};
use axum::http::Request;
use axum::middleware::{from_fn, Next};
use axum::response::Response;
use axum::Router;

/// The `Accept` value a stripped request carries: the bare path's manual.
const MARKDOWN: &str = "text/markdown";

/// The `.md` manual rewrite: `/x.md` → `/x`, `/index.md` → `/`,
/// `/x/index.md` → `/x/`, with `Accept: text/markdown` set. Pure — no I/O,
/// no state.
pub struct MdSuffix;

impl MdSuffix {
    /// Wraps `router` in an outer shell that runs the rewrite BEFORE the
    /// inner router matches. A layer added with `Router::layer` on `router`
    /// itself would run after matching and never see `/x.md` routed, so the
    /// routed app becomes the fallback of a shell router and the rewrite is
    /// layered on the shell.
    pub fn attach(router: Router) -> Router {
        Router::new()
            .fallback_service(router)
            .layer(from_fn(Self::middleware))
    }

    async fn middleware(mut request: Request<Body>, next: Next) -> Response {
        Self::rewrite(&mut request);
        next.run(request).await
    }

    /// Rewrite `req` in place when its path names a `.md` manual: strip the
    /// suffix from the path (query untouched) and replace any caller
    /// `Accept` with `text/markdown`. Applies to every method. Returns
    /// whether it rewrote; a request without the suffix (or whose stripped
    /// form is not a valid URI) is left exactly as it arrived.
    pub fn rewrite<B>(req: &mut Request<B>) -> bool {
        let Some(stripped) = Self::stripped_uri(req.uri()) else {
            return false;
        };
        *req.uri_mut() = stripped;
        req.headers_mut()
            .insert(ACCEPT, HeaderValue::from_static(MARKDOWN));
        true
    }

    /// The URI `uri` routes as once its `.md` suffix is stripped, or `None`
    /// when it carries no suffix. The decision is taken on the fully
    /// percent-decoded path; the raw path is then rebuilt from that same
    /// decision so the two can never disagree.
    pub fn stripped_uri(uri: &Uri) -> Option<Uri> {
        let raw_full = uri.path();
        let decoded_full = Self::fully_decode_path(raw_full);
        let bare = Self::strip(&decoded_full)?;
        let raw_path = Self::rebuild_raw_after_strip(raw_full, &bare);
        let path_and_query = match uri.query() {
            Some(q) => format!("{raw_path}?{q}"),
            None => raw_path,
        };
        let mut parts = uri.clone().into_parts();
        parts.path_and_query = Some(path_and_query.parse::<PathAndQuery>().ok()?);
        Uri::from_parts(parts).ok()
    }

    /// Strip a trailing `.md` suffix from a (decoded) `path`: a path ending
    /// in `/index.md` (or exactly `/index.md` at the root) bares to the
    /// directory it names, WITH its trailing slash; every other
    /// `.md`-suffixed path bares by dropping just the `.md`. `None` when
    /// `path` carries no such suffix (including the degenerate `.md` alone,
    /// which names nothing). Only the tail is examined, so a `.md` in a
    /// middle segment (`/a.md/b`) is not a suffix.
    pub fn strip(path: &str) -> Option<String> {
        let bare = path.strip_suffix(".md")?;
        if bare.is_empty() {
            return None;
        }
        if let Some(dir) = bare.strip_suffix("index") {
            if dir.is_empty() || dir.ends_with('/') {
                return Some(if dir.is_empty() {
                    "/".to_string()
                } else {
                    dir.to_string()
                });
            }
        }
        Some(bare.to_string())
    }

    /// Rebuild the RAW (percent-encoded) path once `strip` has decided — on
    /// the DECODED path — that a `.md` suffix comes off, landing on `bare`.
    /// Stripping only ever touches the LAST `/`-segment (dropping it whole
    /// for the `index.md` collapse, shortening it otherwise), so every
    /// earlier segment keeps the caller's bytes.
    ///
    /// The last segment: when the raw segment decoded cleanly, `bare`'s last
    /// segment is decoded content and is re-encoded into valid raw bytes;
    /// when it did not (an encoded `/` or invalid UTF-8 kept it verbatim),
    /// `bare`'s last segment already IS the raw bytes and encoding it again
    /// would double-encode a caller's `%2F` into `%252F`.
    fn rebuild_raw_after_strip(raw_full: &str, bare: &str) -> String {
        let Some((raw_init, raw_last)) = raw_full.rsplit_once('/') else {
            // A request target always starts with `/`; fall back to the
            // decoded form rather than panicking.
            return bare.to_string();
        };
        if bare.ends_with('/') {
            format!("{raw_init}/")
        } else {
            let bare_last = bare.rsplit('/').next().unwrap_or(bare);
            let decoded_cleanly = matches!(
                Self::percent_decode_utf8(raw_last),
                Some(decoded) if !decoded.contains('/')
            );
            let rebuilt_last = if decoded_cleanly {
                Self::encode_segment(bare_last)
            } else {
                bare_last.to_string()
            };
            format!("{raw_init}/{rebuilt_last}")
        }
    }

    /// Fully decode each `/`-split segment. A segment whose decode would
    /// introduce a `/` (an encoded `%2F`) or is not valid UTF-8 is kept
    /// encoded, so the segment STRUCTURE never changes.
    fn fully_decode_path(path: &str) -> String {
        path.split('/')
            .map(|segment| match Self::percent_decode_utf8(segment) {
                Some(decoded) if !decoded.contains('/') => decoded,
                _ => segment.to_string(),
            })
            .collect::<Vec<_>>()
            .join("/")
    }

    /// One level of percent-decoding, as UTF-8. A `%` not followed by two
    /// hex digits is kept literally (the lenient reading every URL decoder
    /// applies); `None` when the decoded bytes are not valid UTF-8.
    fn percent_decode_utf8(segment: &str) -> Option<String> {
        let bytes = segment.as_bytes();
        let mut out = Vec::with_capacity(bytes.len());
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'%' && i + 2 < bytes.len() {
                if let (Some(hi), Some(lo)) =
                    (Self::hex_value(bytes[i + 1]), Self::hex_value(bytes[i + 2]))
                {
                    out.push(hi << 4 | lo);
                    i += 3;
                    continue;
                }
            }
            out.push(bytes[i]);
            i += 1;
        }
        String::from_utf8(out).ok()
    }

    fn hex_value(b: u8) -> Option<u8> {
        match b {
            b'0'..=b'9' => Some(b - b'0'),
            b'a'..=b'f' => Some(b - b'a' + 10),
            b'A'..=b'F' => Some(b - b'A' + 10),
            _ => None,
        }
    }

    /// Percent-encode every byte that is not an RFC-3986 `pchar`. Used only
    /// to rebuild the one segment whose original encoding cannot be
    /// recovered losslessly.
    fn encode_segment(segment: &str) -> String {
        let mut out = String::with_capacity(segment.len());
        for b in segment.bytes() {
            if Self::is_pchar(b) {
                out.push(b as char);
            } else {
                out.push_str(&format!("%{b:02X}"));
            }
        }
        out
    }

    /// RFC-3986 `pchar` = unreserved / sub-delims / `:` / `@` (the
    /// `pct-encoded` alternative excluded: a literal `%` is always encoded).
    fn is_pchar(b: u8) -> bool {
        b.is_ascii_alphanumeric()
            || matches!(
                b,
                b'-' | b'.' | b'_' | b'~' // unreserved
            | b'!' | b'$' | b'&' | b'\'' | b'(' | b')' | b'*' | b'+' | b',' | b';' | b'=' // sub-delims
            | b':' | b'@'
            )
    }
}

#[cfg(test)]
#[path = "md_suffix_test.rs"]
mod md_suffix_test;
