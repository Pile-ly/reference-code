use std::sync::Arc;

use crate::notes_store::NotesStore;

/// The `hello from <app name>` name on `GET /`. Not read from a
/// `launch.json` field — it names the *shape*, not a specific deployment —
/// so it stays a constant a copier renames rather than an env var.
pub const APP_NAME: &str = "managed-server-reference";

/// The documented `/notes` cap: entries, not bytes.
pub const NOTES_CAPACITY: usize = 100;

/// The entry cap alone does not bound memory — a note has no length limit
/// otherwise, and every accepted one is retained until evicted. At 100
/// entries this keeps the list's worst case in the low hundreds of KiB,
/// nowhere near the box's `memory_max_mib` (`deploy/launch.sh`). A caller
/// sending more gets `413`, not a silently truncated note.
pub const MAX_NOTE_BYTES: usize = 4 * 1024;

/// Shared, `Clone`-cheap application state. Every field a request handler
/// needs lives here, behind `Arc` where it must survive past a single
/// request; `Config`'s two optional strings are copied out at startup
/// because they never change again for the life of the process.
#[derive(Clone)]
pub struct AppState {
    pub notes: Arc<NotesStore>,
    pub server_id: Option<Arc<str>>,
    pub app_version: Option<Arc<str>>,
}

impl AppState {
    pub fn new(server_id: Option<String>, app_version: Option<String>) -> Self {
        AppState {
            notes: Arc::new(NotesStore::with_capacity(NOTES_CAPACITY)),
            server_id: server_id.map(Arc::from),
            app_version: app_version.map(Arc::from),
        }
    }
}
