use excalistore_api::{config::DatabaseUrl, AppState};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let raw_database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let database_url =
        DatabaseUrl::parse(&raw_database_url).expect("DATABASE_URL must be a valid URL");
    tracing::info!(?database_url, "connecting to database");

    let pool = sqlx::PgPool::connect(database_url.as_str())
        .await
        .expect("failed to connect to postgres");
    tracing::info!("running database migrations");
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("Migration must succeed");
    tracing::info!("database migrations up to date");
    let app = excalistore_api::build_router(AppState{pool});

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], 3000));
    tracing::info!("listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
