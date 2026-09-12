// Liveness probe at `GET /healthz`. No auth and no logging — the managed
// box polls it continuously, and one log line per poll would bury the
// request log this app exists to demonstrate.

pub struct Healthz;

impl Healthz {
    pub async fn handler() -> &'static str {
        "ok"
    }
}
