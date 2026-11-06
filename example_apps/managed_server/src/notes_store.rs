use std::collections::VecDeque;
use std::sync::Mutex;

/// The in-memory backing for `GET`/`POST /notes`. Never persisted —
/// resetting on every process start is the point, not a limitation: a
/// managed box's disk is ephemeral, so this is the honest shape for state
/// that must not look durable.
pub struct NotesStore {
    capacity: usize,
    notes: Mutex<VecDeque<String>>,
}

impl NotesStore {
    pub fn with_capacity(capacity: usize) -> Self {
        NotesStore {
            capacity,
            notes: Mutex::new(VecDeque::with_capacity(capacity)),
        }
    }

    /// Appends a note, evicting the oldest once `capacity` is exceeded.
    pub fn push(&self, note: String) {
        let mut notes = Self::lock(&self.notes);
        if notes.len() >= self.capacity {
            notes.pop_front();
        }
        notes.push_back(note);
    }

    /// All notes, oldest first.
    pub fn list(&self) -> Vec<String> {
        Self::lock(&self.notes).iter().cloned().collect()
    }

    /// A poisoned lock here would mean an earlier panic while holding it —
    /// nothing between `lock()` and unlock ever panics, so this recovers
    /// the guard rather than taking the whole process down over a state
    /// that was never actually left inconsistent.
    fn lock(notes: &Mutex<VecDeque<String>>) -> std::sync::MutexGuard<'_, VecDeque<String>> {
        notes.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(test)]
#[path = "notes_store_test.rs"]
mod notes_store_test;
