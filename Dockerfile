# ---- frontend build ----
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- backend build ----
FROM rust:1-slim-bookworm AS backend-build
WORKDIR /app/api
COPY api/Cargo.toml api/Cargo.lock ./
COPY api/.sqlx ./.sqlx
COPY api/src ./src
COPY api/migrations ./migrations
# sqlx's query_as!/query! macros normally type-check against a live
# DATABASE_URL at compile time — there's no Postgres reachable during a
# Docker build, so this tells them to check against the committed
# api/.sqlx/ cache (generated via `cargo sqlx prepare`) instead.
ENV SQLX_OFFLINE=true
RUN cargo build --release

# ---- runtime ----
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=backend-build /app/api/target/release/excalistore-api ./excalistore-api
COPY --from=backend-build /app/api/migrations ./migrations
COPY --from=frontend-build /app/frontend/dist ./static

ENV STATIC_DIR=/app/static
EXPOSE 3000
CMD ["./excalistore-api"]
