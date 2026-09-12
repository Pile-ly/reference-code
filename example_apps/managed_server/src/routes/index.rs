// Handler for `GET /` — identifies the app by name, nothing else.

use crate::state::APP_NAME;

pub struct Index;

impl Index {
    pub async fn handler() -> String {
        format!("hello from {APP_NAME}")
    }
}
