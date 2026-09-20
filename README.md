# ExcaliStore

A self-hosted place to keep your [Excalidraw](https://excalidraw.com) drawings.
Create them, list them, open them, and they save themselves as you draw.
Rust (Axum) backend, React frontend, PostgreSQL storage.

## Run it

All you need is Docker. From the repo root:

```bash
docker compose up --build
```

Then open <http://localhost:3000>, click **New drawing**, and draw. It saves
about a second and a half after you stop, and the corner badge tells you how
it went.

This builds the app from this repo's `Dockerfile` (one container that serves
both the frontend and the API) and starts it next to Postgres. Your drawings
live in the `pgdata` volume, so they survive restarts.

Stop it:

```bash
docker compose down
```

(Add `-v` only if you want to delete the data too.)

Port 3000 busy? Pick another:

```bash
APP_PORT=3001 docker compose up --build
```

## Develop it

You need Docker, Rust, and Node. Compose runs just Postgres; you run the app
from source for fast rebuilds and hot reload. Each command below is meant to be
run on its own.

Start Postgres only:

```bash
docker compose up -d postgres
```

Start the backend on :3000 (it creates the table on first start):

```bash
(cd api && DATABASE_URL=postgres://excalistore:password@localhost:5432/excalistore cargo run)
```

Install the frontend's dependencies:

```bash
npm --prefix frontend install
```

Start the frontend on :5173 (it proxies `/api` to the backend):

```bash
npm --prefix frontend run dev
```

Then open <http://localhost:5173>. In this mode port 3000 only serves the API;
the built frontend is only served by the container.

> The backend reads `DATABASE_URL` from the environment. It does not load a
> `.env` file, which is why it is set inline in the command above.

## Try the API

Each request below runs on its own. Replace `<id>` with an id from the create
or list response.

Create a drawing:

```bash
curl -s -X POST localhost:3000/api/drawings -H 'content-type: application/json' -d '{"title":"My Drawing"}'
```

List drawings:

```bash
curl -s localhost:3000/api/drawings
```

Fetch one:

```bash
curl -s localhost:3000/api/drawings/<id>
```

Update it. Send the version you loaded, or you get a 409:

```bash
curl -s -X PUT localhost:3000/api/drawings/<id> -H 'content-type: application/json' -d '{"title":"My Drawing","scene":{"elements":[],"appState":{},"files":{}},"version":1}'
```

Delete it:

```bash
curl -s -X DELETE localhost:3000/api/drawings/<id>
```

Check health:

```bash
curl -s localhost:3000/health
```

Read the Prometheus metrics:

```bash
curl -s localhost:3000/metrics
```

## Run the tests

The backend tests need Postgres running (see "Develop it").

Backend:

```bash
(cd api && DATABASE_URL=postgres://excalistore:password@localhost:5432/excalistore cargo test)
```

Frontend:

```bash
npm --prefix frontend test
```

The backend tests use the same database as the dev app, so they leave extra
drawings behind.

## Changing the backend's SQL

The image build has no database to check queries against, so it relies on an
offline query cache in `api/.sqlx/`. If you change a SQL query, regenerate it
and commit the result:

```bash
(cd api && DATABASE_URL=postgres://excalistore:password@localhost:5432/excalistore cargo sqlx prepare)
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
