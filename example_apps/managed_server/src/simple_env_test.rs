use super::*;

#[test]
fn a_200_object_is_the_env() {
    let env = SimpleEnv::parse(200, r#"{"API_KEY":"k","LIMITS":{"max":3}}"#).unwrap();
    assert_eq!(env.get("API_KEY"), Some(&Value::String("k".into())));
    assert_eq!(env.get("LIMITS"), Some(&serde_json::json!({"max": 3})));
}

#[test]
fn an_empty_set_is_an_empty_env() {
    assert_eq!(SimpleEnv::parse(200, "{}").unwrap(), EnvMap::new());
}

#[test]
fn a_200_that_is_not_an_object_fails() {
    assert_eq!(
        SimpleEnv::parse(200, "[1,2]"),
        Err(LoadEnvError::NotAnObject)
    );
    assert_eq!(
        SimpleEnv::parse(200, "not json"),
        Err(LoadEnvError::NotAnObject)
    );
}

#[test]
fn a_refusal_carries_its_status_and_code() {
    assert_eq!(
        SimpleEnv::parse(404, r#"{"ok":false,"code":"not_found","reason":"x"}"#),
        Err(LoadEnvError::Refused {
            status: 404,
            code: Some("not_found".into())
        })
    );
}

#[test]
fn a_bodiless_refusal_still_fails() {
    assert_eq!(
        SimpleEnv::parse(413, ""),
        Err(LoadEnvError::Refused {
            status: 413,
            code: None
        })
    );
}

#[tokio::test]
async fn no_backend_token_fails_before_any_request() {
    let client = reqwest::Client::new();
    assert_eq!(
        SimpleEnv::load(&client, "abcd1234", None).await,
        Err(LoadEnvError::NoBackendToken)
    );
}
