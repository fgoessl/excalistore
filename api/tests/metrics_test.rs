use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use excalistore_api::AppState;
use tower::ServiceExt;

#[tokio::test]
async fn metrics_endpoint_exposes_known_counters_at_zero() {
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://excalistore:password@localhost:5432/excalistore".into());
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect(&database_url)
        .await
        .expect("failed to connect to Postgres for test");

    let app = excalistore_api::build_router(AppState { pool });

    let response = app
        .oneshot(
            Request::builder()
                .uri("/metrics")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body = String::from_utf8(bytes.to_vec()).unwrap();

    // pre-registered at 0 — true even though nothing has errored yet
    assert!(body.contains(r#"excalistore_errors_total{kind="not_found"} 0"#));
    assert!(body.contains(r#"excalistore_errors_total{kind="conflict"} 0"#));
    assert!(body.contains(r#"excalistore_errors_total{kind="database"} 0"#));
}
