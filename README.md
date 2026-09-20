# ExcaliStore

A self-hosted place to keep your [Excalidraw](https://excalidraw.com) drawings.
Create them, list them, open them, and they save themselves as you draw.
Rust (Axum) backend, React frontend, PostgreSQL storage.

## Run it

You need Docker, Rust, and Node. From the repo root:

```bash
# 1. Postgres
docker compose up -d postgres

# 2. Backend on :3000 (creates the table on first start)
export DATABASE_URL=postgres://excalistore:password@localhost:5432/excalistore
(cd api && cargo run)
```

In a second terminal:

```bash
# 3. Frontend on :5173, proxying /api to the backend
cd frontend && npm install && npm run dev
```

Open <http://localhost:5173>, click **New drawing**, and draw. It saves about
a second and a half after you stop, and the corner badge tells you how it went.

> The backend reads `DATABASE_URL` from the environment. It does not load a
> `.env` file, so `export` it. If you prefer a file, copy `.env.example` to
> `.env` and run `set -a; source .env; set +a` before `cargo run`.

## Try the API

```bash
# create a drawing
curl -s -X POST localhost:3000/api/drawings \
  -H 'content-type: application/json' \
  -d '{"title":"My Drawing"}'

# list drawings
curl -s localhost:3000/api/drawings

# fetch one (swap in a real id)
curl -s localhost:3000/api/drawings/<id>

# update it: send the version you loaded, or you get a 409
curl -s -X PUT localhost:3000/api/drawings/<id> \
  -H 'content-type: application/json' \
  -d '{"title":"My Drawing","scene":{"elements":[],"appState":{},"files":{}},"version":1}'

# delete it
curl -s -X DELETE localhost:3000/api/drawings/<id>

# health and Prometheus metrics
curl -s localhost:3000/health
curl -s localhost:3000/metrics
```

## Run the tests

```bash
# backend (needs Postgres from step 1)
cd api && DATABASE_URL=postgres://excalistore:password@localhost:5432/excalistore cargo test

# frontend
cd frontend && npm test
```

The backend tests use the same database as the dev app, so they leave extra
drawings behind.

## Run it as one container

The production image serves the built frontend and the API together on port
3000. Postgres runs separately; it is not in the image.

```bash
docker build -t excalistore:v0.1 .

docker network create excalistore-net
docker run -d --name pg --network excalistore-net \
  -e POSTGRES_USER=excalistore -e POSTGRES_PASSWORD=password -e POSTGRES_DB=excalistore \
  postgres:16
docker run -d --name excalistore --network excalistore-net -p 3000:3000 \
  -e DATABASE_URL=postgres://excalistore:password@pg:5432/excalistore \
  excalistore:v0.1
```

Then open <http://localhost:3000>.

If you change a SQL query in the backend, regenerate the offline query cache
that the image build relies on, and commit it:

```bash
cd api && DATABASE_URL=postgres://excalistore:password@localhost:5432/excalistore cargo sqlx prepare
```

## Keep it off the public internet

There is no login yet. The server listens on all interfaces, so anyone who can
reach port 3000 can read, change, or delete every drawing. That is fine on a
home or trusted network. Until authentication lands, do not expose it publicly;
put it behind a firewall or a reverse proxy that handles access.

## How this was built

I built this with AI agent assistance for some parts, mainly the frontend,
test scaffolding, and dev tooling (including the Docker packaging), because
honestly I would not have started it without that help; the amount of work
would have been more than I would have taken on alone. The core of the app,
the Rust CRUD backend, I wrote myself.
