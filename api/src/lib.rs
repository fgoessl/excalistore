pub mod config;
pub mod error;
pub mod metrics;

use axum::{routing::get, Router};
use tower_http::trace::TraceLayer;

#[derive(Clone)]
pub struct AppState {
    pub pool: sqlx::PgPool
}


pub fn build_router(state: AppState) -> Router {
    metrics::init();

    Router::new()
        .route("/health", get(health))
        .route("/metrics", get(metrics::metrics_handler))
        .with_state(state)
        .layer(TraceLayer::new_for_http())
}

async fn health() -> &'static str {
    "ok"
}
