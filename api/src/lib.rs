pub mod config;
pub mod drawings;
pub mod error;
pub mod metrics;

use axum::{middleware, routing::get, Router};
use tower_http::trace::TraceLayer;

use crate::drawings::{
    create_drawing, delete_drawing, fetch_drawing, list_drawings, update_drawing,
};

#[derive(Clone)]
pub struct AppState {
    pub pool: sqlx::PgPool,
}

pub fn build_router(state: AppState) -> Router {
    metrics::init();

    Router::new()
        .route("/health", get(health))
        .route("/metrics", get(metrics::metrics_handler))
        .route("/api/drawings", get(list_drawings).post(create_drawing))
        .route(
            "/api/drawings/:id",
            get(fetch_drawing).put(update_drawing).delete(delete_drawing),
        )
        .route_layer(middleware::from_fn(metrics::track_metrics))
        .with_state(state)
        .layer(TraceLayer::new_for_http())
}

async fn health() -> &'static str {
    "ok"
}
