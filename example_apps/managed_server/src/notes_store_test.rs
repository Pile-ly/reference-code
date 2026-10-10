use super::*;

#[test]
fn starts_empty() {
    let store = NotesStore::with_capacity(100);
    assert_eq!(store.list(), Vec::<String>::new());
}

#[test]
fn round_trips_in_insertion_order() {
    let store = NotesStore::with_capacity(100);
    store.push("first".to_string());
    store.push("second".to_string());
    assert_eq!(store.list(), vec!["first".to_string(), "second".to_string()]);
}

#[test]
fn caps_at_capacity_by_evicting_the_oldest() {
    let store = NotesStore::with_capacity(3);
    store.push("a".to_string());
    store.push("b".to_string());
    store.push("c".to_string());
    store.push("d".to_string());
    assert_eq!(
        store.list(),
        vec!["b".to_string(), "c".to_string(), "d".to_string()]
    );
    assert_eq!(store.list().len(), 3);
}

#[test]
fn one_hundred_is_the_documented_default_cap() {
    let store = NotesStore::with_capacity(100);
    for i in 0..105 {
        store.push(i.to_string());
    }
    let notes = store.list();
    assert_eq!(notes.len(), 100);
    // The oldest 5 (0..5) were evicted; the list starts at "5".
    assert_eq!(notes.first(), Some(&"5".to_string()));
    assert_eq!(notes.last(), Some(&"104".to_string()));
}
