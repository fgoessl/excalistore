#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let app = excalistore_api::build_router();

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], 3000));
    tracing::info!("listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
