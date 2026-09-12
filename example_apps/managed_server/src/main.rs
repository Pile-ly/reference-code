//! The managed-server reference app — the shape every `@simple_server` app
//! starts from. See README.md for the contract a managed app must meet and
//! how to run this one locally.

mod config;
mod logging;
mod notes_store;
mod requester;
mod routes;
mod state;

use config::Config;
use routes::Routes;
use state::AppState;

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

/// One way every startup failure below is reported: a plain message to
/// stderr and a clean non-zero exit — never a panic. A managed box's
/// journal is read as log lines, not backtraces, and every fatal path
/// here (bad `PORT`, a bind failure, a signal handler that can't
/// install) is equally "this process cannot start," so all of them go
/// through the same door.
struct Fatal;

impl Fatal {
    fn exit(message: impl std::fmt::Display) -> ! {
        eprintln!("fatal: {message}");
        std::process::exit(1);
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .with_target(false)
        .init();

    let config = Config::from_env().unwrap_or_else(|err| Fatal::exit(err));

    let state = AppState::new(config.server_id, config.app_version);
    let app = Routes::router(state);

    let addr = format!("0.0.0.0:{}", config.port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|err| Fatal::exit(format!("failed to bind {addr}: {err}")));

    if let Err(err) = axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
    {
        Fatal::exit(format!("server exited unexpectedly: {err}"));
    }
}

/// Resolves on SIGTERM (how systemd stops `simple-server-app.service`) or
/// SIGINT (Ctrl-C during local `cargo run`), so a rolling deploy or a
/// manual stop drains in-flight requests instead of dropping them.
async fn shutdown_signal() {
    use tokio::signal::unix::{signal, SignalKind};

    let mut sigterm = signal(SignalKind::terminate())
        .unwrap_or_else(|err| Fatal::exit(format!("failed to install SIGTERM handler: {err}")));
    let ctrl_c = async {
        if let Err(err) = tokio::signal::ctrl_c().await {
            Fatal::exit(format!("failed to install SIGINT handler: {err}"));
        }
    };

    tokio::select! {
        _ = sigterm.recv() => {},
        _ = ctrl_c => {},
    }
}
