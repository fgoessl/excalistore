use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use excalistore_api::AppState;
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

#[tokio::test]
async fn health_returns_200_ok() {
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://excalistore:password@localhost:5432/excalistore".into());
    let pool = PgPoolOptions::new()
        .connect(&database_url)
        .await
        .expect("failed to connect to Postgres for test");

    let app = excalistore_api::build_router(AppState { pool });

    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn unmatched_route_falls_back_to_index_html() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("index.html"), "<html>ExcaliStore</html>").unwrap();
    std::env::set_var("STATIC_DIR", dir.path().to_str().unwrap());

    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://excalistore:password@localhost:5432/excalistore".into());
    let pool = PgPoolOptions::new()
        .connect(&database_url)
        .await
        .expect("failed to connect to Postgres for test");

    let app = excalistore_api::build_router(AppState { pool });

    let response = app
        .oneshot(
            Request::builder()
                .uri("/drawings/some-id")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    std::env::remove_var("STATIC_DIR");
}
