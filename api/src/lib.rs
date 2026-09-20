pub mod config;
pub mod drawings;
pub mod error;
pub mod metrics;

use axum::{middleware, routing::get, Router};
use tower_http::services::{ServeDir, ServeFile};
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

    let api_router = Router::new()
        .route("/health", get(health))
        .route("/metrics", get(metrics::metrics_handler))
        .route("/api/drawings", get(list_drawings).post(create_drawing))
        .route(
            "/api/drawings/{id}",
            get(fetch_drawing).put(update_drawing).delete(delete_drawing),
        )
        .route_layer(middleware::from_fn(metrics::track_metrics))
        .with_state(state)
        .layer(TraceLayer::new_for_http());

    // Any request that doesn't match an API route falls back to the
    // compiled frontend's static files, with index.html served for any
    // path that isn't a file on disk — the SPA's own router (react-router)
    // then takes over client-side for paths like /drawings/:id.
    let static_dir = std::env::var("STATIC_DIR").unwrap_or_else(|_| "frontend/dist".to_string());
    let index_path = format!("{static_dir}/index.html");
    let serve_dir = ServeDir::new(&static_dir).fallback(ServeFile::new(index_path));

    api_router.fallback_service(serve_dir)
}

async fn health() -> &'static str {
    "ok"
}
