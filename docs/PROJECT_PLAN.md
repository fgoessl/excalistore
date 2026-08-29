# ExcaliStore — Project Plan

A self-hosted, persistent web application for storing, organizing, and editing
Excalidraw drawings. This document is the full architecture and implementation
plan, intended to be handed to Claude Code (or any engineer) to begin
implementation.

Repository name: **excalistore**

Description: *Self-hosted, persistent web app for storing and organizing
Excalidraw drawings — Rust/Axum backend, React frontend, PostgreSQL storage.*

---

## 1. What ExcaliStore Is

ExcaliStore is **not** a reimplementation of Excalidraw and not a replacement
for it. It is a thin persistence/management layer built around the existing
`@excalidraw/excalidraw` React component.

Division of responsibility:

- **Excalidraw** (npm package) — the actual drawing editor: canvas, shapes,
  arrows, selection, zoom, undo/redo, text editing, serialization, export.
  We do not reimplement any of this.
- **ExcaliStore** — persistence, browsing/listing, autosave, authentication
  boundary, and (later) permissions.
- **Rust (Axum)** — backend API.
- **PostgreSQL** — storage, using JSONB for the drawing scene.
- **Kubernetes / Helm** — deployment.
- **Keycloak** — optional OIDC identity provider (added in v0.3, not required
  for v0.1/v0.2).
- **oauth2-proxy** — optional auth proxy sitting in front of the app (added
  with Keycloak in v0.3).
- **excalidraw-room** — explicitly **out of scope** unless live collaboration
  becomes a real requirement later (v0.4+, not currently planned).

### Why build this instead of using an existing Excalidraw-persistence project

Control. Using a third-party persistence wrapper means trusting it with auth,
authorization, DB access, persistence behavior, Excalidraw compatibility,
dependency updates, and security fixes. Our requirements are simple enough
that a small custom wrapper is more maintainable and more trustworthy than an
unfamiliar third-party dependency doing the same job.

### High-level data flow

```
Browser
   │
   ▼
React + Excalidraw
   │
   ▼
Rust API (Axum)
   │
   ▼
PostgreSQL
```

---

## 2. Repository Structure

**Single repository**, not split across `excalistore-frontend` /
`excalistore-api` / `excalistore-helm`. Rationale: frontend, backend,
migrations, and Helm chart are one product and should ship as one atomic
change / one release / one version.

```
excalistore/
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── DrawingList.tsx
│   │   │   └── SaveStatus.tsx
│   │   ├── pages/
│   │   │   ├── DrawingsPage.tsx
│   │   │   └── EditorPage.tsx
│   │   ├── api/
│   │   │   └── api.ts
│   │   └── App.tsx
│   ├── package.json
│   └── vite.config.ts
│
├── api/
│   ├── src/
│   │   ├── main.rs
│   │   ├── auth.rs
│   │   ├── drawings.rs
│   │   └── error.rs
│   ├── migrations/
│   │   ├── 001_create_drawings.up.sql
│   │   ├── 001_create_drawings.down.sql
│   │   ├── 002_add_permissions.up.sql       (v0.3)
│   │   └── 002_add_permissions.down.sql     (v0.3)
│   └── Cargo.toml
│
├── helm/
│   └── excalistore/
│       ├── Chart.yaml
│       ├── values.yaml
│       └── templates/
│           ├── deployment.yaml
│           ├── service.yaml
│           ├── ingress.yaml
│           └── migration-job.yaml
│
├── keycloak/
│   └── realm-export.json          (added in v0.3 only)
│
├── compose.yaml
├── Dockerfile
├── .env.example
├── README.md
└── .github/
    └── workflows/
```

---

## 3. Frontend (React + TypeScript + Vite)

Rust-for-frontend (Dioxus/Leptos/Yew) was explicitly considered and rejected:
Excalidraw itself is a React/TypeScript component, so using Rust/WASM for the
frontend would add unnecessary integration complexity for no benefit. Decision:
**React + TypeScript + Vite + `@excalidraw/excalidraw`.**

The frontend is intentionally thin — it does not implement any drawing logic.
It is responsible for:

- routing
- drawing list UI
- API calls
- autosave state / save-status UI
- basic UI polish around the embedded Excalidraw component

Core embed:

```tsx
<Excalidraw
  initialData={drawing}
  onChange={handleChange}
/>
```

### Routing

```
/                      → drawing list
/drawings/:id          → editor for a specific drawing (UUID in the URL)
/drawings/new          → create + redirect to /drawings/:new-id
```

Example URL: `https://excalistore.internal/drawings/8f14e45f-ceea-467a-9575-6a0e5b8dc2f9`

**Decision:** the server generates the UUID on `POST /api/drawings` and
returns it; the client redirects to `/drawings/:id` after creation. (Simpler
than client-generated UUIDs; avoids collision edge cases. Revisit only if an
offline-first creation flow is ever needed.)

Deep-linking into a specific viewport/zoom/selection via query params
(`?zoom=2&x=100&y=200`) is technically possible via Excalidraw's `appState`
but is **not planned for v1** — only build if a concrete use case shows up.

### Autosave

```
User edits
   ↓
Excalidraw onChange
   ↓
mark dirty
   ↓
debounce ~1–2 seconds
   ↓
PUT /api/drawings/:id
   ↓
Rust API
   ↓
PostgreSQL
```

UI states to support: `✓ Saved`, `⟳ Saving…`, `⚠ Save failed — retry`.
Optionally retain a local copy in the browser as a safety net against failed
saves.

### Estimated frontend effort (reference only)

| Task | Approx. effort |
|---|---|
| React/Vite setup | 1–2 hours |
| Embed Excalidraw | 1–2 hours |
| Drawing list | 2–4 hours |
| Create/open/delete | 2–4 hours |
| Load drawing | 2–3 hours |
| Autosave | 2–4 hours |
| Save status/errors | 2–4 hours |
| Routing | 1–2 hours |
| Basic UI polish | 4–8 hours |

### Keycloak and the frontend (relevant starting v0.3)

The frontend does **not** need any OIDC/Keycloak SDK code, token storage, or
refresh handling. Auth is handled entirely at the ingress/proxy layer
(oauth2-proxy). The frontend simply does:

```ts
fetch("/api/drawings")
```

relying on the browser's existing authenticated session cookie set by
oauth2-proxy.

---

## 4. Backend (Rust)

Stack:

- **Axum** — HTTP framework
- **SQLx** — PostgreSQL access (see §7 for why SQLx over an ORM)
- **serde / serde_json** — serialization
- **tower-http** — middleware
- OIDC/JWT validation, added only in v0.3

### Endpoints (v0.1)

```
GET    /api/drawings
POST   /api/drawings
GET    /api/drawings/:id
PUT    /api/drawings/:id
DELETE /api/drawings/:id
```

Potential future endpoint (not v1): `POST /api/drawings/:id/share`.

### Design principle: treat the Excalidraw scene as opaque JSON

The backend does not need to understand Excalidraw's internal shape/element
model. It only needs to:

```
React/Excalidraw
       │
       ▼
JSON scene
       │
       ▼
Rust: authenticate → authorize → validate size/format → version check → store
       │
       ▼
PostgreSQL JSONB
```

This keeps ExcaliStore loosely coupled to Excalidraw's internal scene
representation, so upstream Excalidraw changes don't require backend schema
changes.

---

## 5. Database Schema (PostgreSQL)

Deliberately minimal — one primary table, JSONB for the scene, no attempt to
model Excalidraw's internal structure relationally.

```sql
CREATE TABLE drawings (
    id UUID PRIMARY KEY,
    title TEXT NOT NULL,
    scene JSONB NOT NULL,
    owner_id TEXT,
    version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Notes:

- `owner_id` is **nullable** — v0.1/v0.2 run with no auth at all, so drawings
  are ownerless (`owner_id = NULL`) until v0.3.
- `owner_id`, once populated, is the Keycloak **`sub`** claim (see §9) — never
  username or email, since only `sub` is guaranteed stable across profile
  changes.
- `scene` contains the full Excalidraw scene JSON: `elements`, `appState`,
  `files` (including embedded image data for v1 — see below).

### Images

For v1, image data (e.g. pasted screenshots) is stored inline inside
`scene.files`, alongside `elements` and `appState` — no object storage needed
yet. If large images become a real problem later, migrate to S3/MinIO:

```
Excalidraw
   │
   ├── scene → PostgreSQL
   └── image → S3/MinIO   (future, only if needed)
```

Do not build object storage support preemptively.

### Optimistic versioning (build this in from day one, not later)

Prevents silent overwrites without needing real-time collaboration:

```sql
UPDATE drawings
SET
    scene = $1,
    version = version + 1,
    updated_at = now()
WHERE id = $2
  AND version = $3;
```

If the `UPDATE` affects 0 rows, the drawing was modified since the client
loaded it → return `409 Conflict`. Client is responsible for handling the
conflict (e.g. reload + prompt user, or show a merge/overwrite choice).

### Future table (v0.3+): permissions

```sql
CREATE TABLE drawing_permissions (
    drawing_id UUID NOT NULL REFERENCES drawings(id),
    principal TEXT NOT NULL,   -- either a Keycloak user `sub` or a group name
    role TEXT NOT NULL         -- 'viewer' | 'editor'
);
```

`principal` can reference either an individual user's `sub` or a Keycloak
group name — group membership is resolved from the JWT's `groups` claim at
request time, so no local group table is needed.

---

## 6. Database Migrations (SQLx)

SQLx migrations are the Rust-world equivalent of Alembic (Python). Migrations
are plain paired `.up.sql` / `.down.sql` files, tracked in an
auto-created `_sqlx_migrations` table.

```
api/migrations/
├── 001_create_drawings.up.sql
├── 001_create_drawings.down.sql
├── 002_add_permissions.up.sql
└── 002_add_permissions.down.sql
```

### CLI workflow (demonstrative)

Install:
```bash
cargo install sqlx-cli --no-default-features --features rustls,postgres
```

Set connection string:
```bash
export DATABASE_URL=postgres://excalistore:password@localhost:5432/excalistore
```

Apply all pending migrations:
```bash
sqlx migrate run
```

Revert the most recently applied migration:
```bash
sqlx migrate revert
```

Check status:
```bash
sqlx migrate info
```

**Caution:** `sqlx migrate revert` is fine in local/dev/CI but risky in
production if a down-migration drops data. In practice, prefer "roll forward
with a fix" over reverting schema on a live production database.

### Kubernetes migration strategy

Migrations run via a dedicated Kubernetes **Job**, not on every application
pod's startup — otherwise multiple replicas would race to apply migrations
concurrently.

```
Helm upgrade
    │
    ▼
Migration Job  (runs `sqlx migrate run` once)
    │
    ▼
ExcaliStore Deployment rolls out
```

---

## 7. Why SQLx Over an ORM

Deliberate choice, specific to this project's shape (not a general anti-ORM
stance):

1. **Schema is intentionally tiny and JSONB-heavy** — essentially one real
   table. ORMs earn their value with many related tables and complex joins;
   here we're intentionally avoiding a rich relational model.
2. **Compile-time checked raw SQL without a query-builder DSL** — `query!` /
   `query_as!` macros validate SQL against the real schema at compile time,
   giving type safety without an abstraction layer in between.
3. **Optimistic versioning is a raw-SQL idiom** — the
   `UPDATE ... WHERE version = $2` + `rows_affected()` pattern is trivial in
   raw SQL; ORMs often fight this (either drop to raw SQL anyway, or wrestle
   with inconsistent optimistic-locking support).
4. **JSONB handling is direct** — SQLx maps JSONB to `serde_json::Value`
   fairly transparently, matching the "treat scene as opaque JSON" principle.
5. **Fewer moving parts** — no schema DSL to keep in sync (e.g. Diesel's
   `schema.rs`); migrations are just SQL files.

**Revisit this decision if:** the schema grows into many genuinely relational
entities with heavy cross-table joins (e.g. `users`, `shares`, `comments`,
`drawing_permissions` all becoming complex first-class relations queried
together constantly). Not expected through v0.3.

---

## 8. Authentication Architecture (v0.3, optional overall)

**Key principle: Keycloak is not a fundamial dependency.** ExcaliStore works
standalone with no auth at all:

```
Browser → ExcaliStore → PostgreSQL
```

It can be protected instead by VPN, private network, existing corporate auth
infra, or ingress-level access control — Keycloak can be added later without
architectural rework.

### Full intended v0.3+ architecture

```
Browser
   │
   ▼
Ingress
   │
   ▼
oauth2-proxy
   │
   ▼
Keycloak
   │
   ▼
ExcaliStore
   │
   ▼
PostgreSQL
```

Design principle: **don't bake Keycloak deeply into drawing logic.** The
backend works against an abstract `AuthContext`:

```
AuthContext
├── sub (stable user id)
├── username
└── groups/roles
```

This context can be absent (v0.1/v0.2), stubbed (dev mode, see §11), or
populated from a real validated JWT (production, v0.3).

### oauth2-proxy's role

Handles the entire OIDC login flow so the app never has to:

1. Unauthenticated request → oauth2-proxy finds no session cookie → redirects
   browser to Keycloak login.
2. User authenticates at Keycloak (Keycloak owns the login form/MFA) →
   Keycloak redirects back to oauth2-proxy's callback URL with an
   authorization code.
3. oauth2-proxy exchanges the code for tokens server-to-server (browser never
   sees this) → receives ID token, access token, refresh token.
4. oauth2-proxy creates its own session: stores tokens (encrypted cookie or
   Redis) and sets a session cookie on the browser; redirects to the
   originally requested URL.
5. Every subsequent request: oauth2-proxy validates the session cookie,
   silently refreshes the access token via the refresh token if needed, and
   forwards the request to ExcaliStore with identity attached.

Two modes for how identity reaches the backend:

- **Header mode** — oauth2-proxy injects trusted headers (`X-Forwarded-User`,
  `X-Forwarded-Email`, `X-Forwarded-Groups`). Simplest, but **requires** the
  API to be unreachable except through the proxy (see security note below),
  or headers could be forged by a client reaching the API directly.
- **Bearer token pass-through** — oauth2-proxy forwards the actual JWT in an
  `Authorization` header; the backend verifies the signature itself against
  Keycloak's JWKS. More defense-in-depth (safe even if the API is reachable
  directly), slightly more backend code.

**Recommendation:** bearer-token mode for defense-in-depth if cheap to
implement; otherwise header mode + a properly network-isolated internal
Kubernetes Service is acceptable.

### Critical security requirement

If using header mode, the ExcaliStore backend service **must not** be
reachable except through the trusted ingress/proxy path:

```
Internet → Ingress → oauth2-proxy → ExcaliStore Service (internal only)
```

Otherwise an attacker could bypass the proxy and forge identity headers
directly against the backend.

### Other proxy options considered (not chosen, noted for reference)

- Pomerium
- Traefik ForwardAuth + oauth2-proxy (natural pairing if already on Traefik)
- NGINX Ingress + oauth2-proxy (equally natural if already on NGINX)

oauth2-proxy was the primary recommendation regardless of ingress choice.

### OAuth/OIDC flow: Authorization Code Flow with PKCE

This is the only flow needed for this architecture.

- **Authorization Code Flow** — tokens are exchanged server-to-server
  (oauth2-proxy ↔ Keycloak), never exposed directly in the browser. Correct
  choice for any setup with a confidential backend component.
- **PKCE** — additional protection against authorization-code interception;
  oauth2-proxy supports and typically defaults to it. Recommended even for
  confidential clients as defense-in-depth.
- **Implicit Flow** — rejected (deprecated, exposes tokens in browser
  URL/history).
- **Client Credentials Flow** — not applicable (no human user involved).
- **Resource Owner Password Flow** — rejected (app would collect
  username/password directly, defeating the point of SSO).

### Keycloak client configuration required

- Client ID: `excalistore`
- Access Type: `confidential` (oauth2-proxy holds a client secret)
- Standard Flow: enabled (Keycloak's name for Authorization Code Flow)
- Valid redirect URI: oauth2-proxy's callback, e.g.
  `https://excalistore.internal/oauth2/callback`
- A generated client secret, supplied to oauth2-proxy's config

---

## 9. Identity Details: `sub`, OIDC, JWT (background/reference)

### Why `owner_id` must be the `sub` claim, not username/email

`sub` (subject) is the one OIDC claim guaranteed stable and immutable for a
given Keycloak account — it does not change if the user changes their
username, email, or display name. Always key foreign references (like
`owner_id`) off `sub`.

Known edge cases where `sub` *can* change (acceptable to ignore for v1–v0.3,
not engineered around unless they actually occur):

- The user's Keycloak account is deleted and a new one created (not merely
  deactivated) → new `sub`, old drawings orphaned.
- A realm migration/reinstall that doesn't preserve user IDs.
- (Federated login via Google/GitHub/etc. through Keycloak does **not** break
  this — Keycloak still mints its own stable local `sub` for the federated
  identity.)

Mitigation if this ever matters: don't hard-delete drawings whose `owner_id`
no longer resolves — surface them to admins as "orphaned" instead.

### What OIDC is

OpenID Connect is an identity layer on top of OAuth 2.0. OAuth 2.0 alone
answers "can this app act on the user's behalf" (authorization) and issues an
**access token**. OIDC adds "who is this user" (authentication) and issues an
**ID token** — a signed JWT with identity claims (`sub`, `email`,
`preferred_username`, `groups`, etc.). Keycloak is the OIDC provider (IdP);
oauth2-proxy performs the OIDC flow on the app's behalf.

### What a JWT is

A compact, signed token representing claims, structured as three
base64url-encoded parts:

```
header.payload.signature
```

- **Header** — signing algorithm (e.g. RS256) and token type.
- **Payload** — the claims (`sub`, `email`, `groups`, `exp`, etc.). This is
  only base64-encoded, **not encrypted** — readable by anyone who has the
  token. Never put secrets in a JWT payload.
- **Signature** — Keycloak signs with its private key; the backend verifies
  using Keycloak's public key (fetched via Keycloak's JWKS endpoint, part of
  OIDC discovery at `/.well-known/openid-configuration`).

Verification is local/stateless — no database or network round-trip to
Keycloak needed per request, just signature + `exp` check. JWTs are typically
short-lived (minutes); refresh-token renewal is handled entirely by
oauth2-proxy, invisible to both the frontend and backend.

---

## 10. Local Development: Two Modes

### Mode A — bare Postgres, no auth (day-to-day iteration, v0.1/v0.2)

```
Your machine
├── frontend → npm run dev
└── api      → cargo run
                │
                ▼
          Docker Compose (Postgres only)
```

`compose.yaml` for this mode only needs Postgres:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: excalistore
      POSTGRES_PASSWORD: password
      POSTGRES_DB: excalistore
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

`AuthContext` is absent entirely — `owner_id` stays `NULL`, no auth
middleware runs. This is the correct/only mode needed through v0.1 and v0.2.

Optionally, `docker compose up --build` can bring up the full production-like
image (ExcaliStore + Postgres) for CI/integration testing/dev onboarding,
still without Keycloak.

### Mode B — full stack incl. Keycloak + oauth2-proxy (v0.3 auth testing only)

Only introduced once actively building/testing the Keycloak integration —
**not** part of routine frontend/backend iteration.

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: excalistore
      POSTGRES_PASSWORD: password
      POSTGRES_DB: excalistore
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  keycloak:
    image: quay.io/keycloak/keycloak:26.0
    command: start-dev --import-realm
    environment:
      KEYCLOAK_ADMIN: admin
      KEYCLOAK_ADMIN_PASSWORD: admin
    ports:
      - "8080:8080"
    volumes:
      - ./keycloak/realm-export.json:/opt/keycloak/data/import/realm.json

  oauth2-proxy:
    image: quay.io/oauth2-proxy/oauth2-proxy:v7.6.0
    command:
      - --provider=keycloak-oidc
      - --oidc-issuer-url=http://keycloak:8080/realms/excalistore
      - --client-id=excalistore
      - --client-secret=changeme-client-secret
      - --redirect-url=http://localhost:4180/oauth2/callback
      - --upstream=http://excalistore:3000
      - --http-address=0.0.0.0:4180
      - --cookie-secret=changeme-32-byte-base64-secret==
      - --email-domain=*
    ports:
      - "4180:4180"
    depends_on:
      - keycloak
      - excalistore

  excalistore:
    build: .
    environment:
      DATABASE_URL: postgres://excalistore:password@postgres:5432/excalistore
    depends_on:
      - postgres
    # No ports published — only oauth2-proxy is exposed to the host,
    # mirroring the "API unreachable except via proxy" security rule.

volumes:
  pgdata:
```

Important gotcha: `--oidc-issuer-url` uses the **Docker network hostname**
(`keycloak:8080`) because oauth2-proxy talks to Keycloak server-to-server,
while `--redirect-url` uses **`localhost:4180`** because that's what the
*browser* on the host machine can actually reach.

Local dev workflow with Mode B:

```bash
docker compose up
```

Then visit `http://localhost:4180` → redirected to Keycloak login → log in
with a seeded test user → redirected back to ExcaliStore with `sub`/`groups`
now available to the Axum handlers.

### Dev-mode auth stub (bridges Mode A and real JWT validation)

Once `AuthContext` extraction exists (v0.3), avoid requiring the full
Keycloak/oauth2-proxy stack for routine backend iteration by supporting an
env-switch:

```rust
// only used when AUTH_MODE=dev
async fn dev_auth_context() -> AuthContext {
    AuthContext {
        sub: "dev-user-1".into(),
        username: "alice".into(),
        groups: vec!["editors".into()],
    }
}
```

```
AUTH_MODE=dev   → dev_auth_context() used, no JWT/Keycloak needed at all
AUTH_MODE=jwt   → real Keycloak-issued JWT validated against JWKS
```

This lets permission-checking / ownership logic be written and tested without
running Postgres + Keycloak + oauth2-proxy together for routine iteration.
Switch to `AUTH_MODE=jwt` + Mode B only to verify the real integration
end-to-end (pre-release, or debugging auth-specific issues).

**Critical safety guard:** `AUTH_MODE=dev` must be impossible to run in
production by accident — e.g. panic on startup if `AUTH_MODE=dev` is set
alongside a production-indicator env var (e.g. `ENVIRONMENT=production`). A
stub-auth bypass accidentally shipped to prod is a serious failure mode to
design against from the start.

---

## 11. Keycloak Realm Export (for Mode B / v0.3)

A Keycloak "realm" bundles clients, users, groups, roles, and auth flow
config into one JSON file, used to bootstrap a working Keycloak instance
without manual admin-console clicking on every `docker compose up`.

### One-time authoring steps

1. `docker compose up keycloak`
2. Visit `http://localhost:8080`, log in as admin.
3. Create realm `excalistore`.
4. Create client `excalistore` — confidential, Standard Flow enabled,
   redirect URI `http://localhost:4180/oauth2/callback`.
5. Create a test user (e.g. `alice` / `password123`).
6. Optionally create groups (e.g. `editors`).

### Export

Via admin console: **Realm settings → Action → Partial/Full export.**

Via CLI (includes test user accounts/passwords, which is desired for a dev
fixture — excluded by default for safety otherwise):

```bash
docker compose exec keycloak /opt/keycloak/bin/kc.sh export \
  --realm excalistore \
  --file /tmp/realm-export.json \
  --users realm_file
docker compose cp keycloak:/tmp/realm-export.json ./keycloak/realm-export.json
```

Commit `keycloak/realm-export.json` to the repo. `--import-realm` in the
Mode B compose file auto-loads it on every startup.

### Client secret handling

- **Local dev:** the placeholder secret (`changeme-client-secret`) committed
  in `compose.yaml` is fine — it only unlocks a throwaway local Keycloak
  instance.
- **Production:** generate a real secret in Keycloak (**Clients →
  excalistore → Credentials → regenerate**). Never commit it. Reference it in
  the Helm deployment via a Kubernetes `Secret`:

```yaml
env:
  - name: OAUTH2_PROXY_CLIENT_SECRET
    valueFrom:
      secretKeyRef:
        name: excalistore-oidc-secret
        key: client-secret
```

The `Secret` object itself is created out-of-band (sealed-secrets,
external-secrets-operator, or manual `kubectl create secret`) and lives only
in the company's private deployment repo/config — never in the public
ExcaliStore repo (see §14).

---

## 12. Docker Image Strategy

**Single production image**, containing both the compiled React frontend and
the Rust/Axum binary. Rust serves both the static frontend and the API:

```
ExcaliStore container
├── compiled React static files
└── Rust/Axum
      ├── /            → React
      ├── /drawings/... → React
      └── /api/...      → Axum → PostgreSQL
```

This means Kubernetes only needs **one** application Deployment — no separate
frontend service, no internal frontend↔API networking, no CORS config, no
extra ingress rules for v1.

**Database is the one thing kept out of this image** — Postgres is stateful,
needs its own backup/failover/persistence story, and must run as its own
service (never bundled into the app container, which would risk data loss on
pod restarts and prevent safe rolling updates).

Trade-offs of the single-image approach (accepted for this project's scale):

- No independent scaling of frontend vs. backend (acceptable — static file
  serving is cheap, scales trivially with the API pod).
  - Frontend-only changes require a full rebuild/redeploy (acceptable at this
  scale).
- Multi-stage Dockerfile is more complex than either stage alone (Node build
  → Rust build → slim runtime), but this is standard practice.

General rule applied: split services only when there's a concrete reason
(different scaling profiles, different teams, different deploy cadences) —
not preemptively. None of those reasons currently apply.

---

## 13. Kubernetes / Helm (v0.2)

```
helm/
└── excalistore/
    ├── Chart.yaml
    ├── values.yaml
    └── templates/
        ├── deployment.yaml
        ├── service.yaml
        ├── ingress.yaml
        └── migration-job.yaml
```

The chart must stay **generic** — no company-specific configuration
hardcoded. Example of what the generic chart exposes via `values.yaml`:

```yaml
ingress:
  enabled: true
database:
  url: ...
resources:
  ...
env:
  ...
```

Company-specific values (internal hostname, ingress config, resource limits,
DB config, Keycloak settings, secret references, internal policies) live in a
**separate, private** values file/repo (see §14) — never in the public chart.

The migration Job (see §6) runs before the Deployment rolls out on every
`helm upgrade`.

---

## 14. Public Repo vs. Private Company Deployment

Recommended split:

```
PUBLIC (github.com/you/excalistore)
   frontend/, api/, helm/
        │
        ▼
   CI/CD: build → test → scan → publish
        │
        ▼
   released artifact (Docker image + Helm chart, versioned)
        │
        ▼
COMPANY KUBERNETES (private repo)
   company-excalistore-deployment/
   └── values-production.yaml
       (internal hostname, ingress config, resource limits,
        DB config, Keycloak settings, secret references,
        company-specific policies)
```

The public project never contains company-specific deployment details or
secrets.

### Release versioning

Production pins a specific tagged release (`v0.1.0`, `v0.2.0`, `v0.3.0`, ...)
rather than tracking `main` — predictable upgrades, clean rollback story.

### Helm chart distribution options (pick one when the chart is ready)

- **GitHub Pages Helm repo**, e.g. `https://you.github.io/excalistore`
- **OCI registry**, e.g. `oci://ghcr.io/yourname/excalistore` (arguably
  preferable — modern, keeps the chart alongside the container image in
  GHCR)

---

## 15. Keycloak: Adoption / Trust Context (background, not a decision point)

- Keycloak is open-source (Apache 2.0), self-hosted, and does not phone home
  or depend on any third-party service — all identity data (users, sessions,
  tokens) stays entirely within your own infrastructure. This is a genuine
  advantage over hosted IdPs (Auth0, Okta, Clerk) for an internal,
  privacy-conscious tool.
- Originally a Red Hat project, now community-governed — mature, not a hobby
  project. Used at real scale (e.g. large enterprise identity deployments;
  Keycloak's own case studies include multi-million-user deployments).
- Smaller market share than commercial directory-service competitors
  (Google Identity Platform, Microsoft Entra ID/AD), which makes sense since
  those dominate among orgs already deep in Google Workspace/Microsoft 365 —
  Keycloak's niche is specifically self-hosted, vendor-neutral OIDC/SAML,
  which matches this project's requirements exactly.
- One practical caution: JWT payloads are plaintext (not encrypted) — avoid
  logging full request headers/tokens in application logs, since doing so
  would log identity claims.

**Verdict:** not too much to add to the repo footprint-wise (it's one
external container + one committed realm-export JSON file), and appropriate
in complexity — but correctly deferred to v0.3, not introduced before the
persistence MVP works.

---

## 16. Versioned Roadmap

### v0.1 — Persistence MVP (no auth)

- [ ] `api/migrations/001_create_drawings.up.sql` / `.down.sql`
- [ ] Axum handlers: list / create / get / update (optimistic-versioned) /
      delete
- [ ] `AuthContext` absent entirely — no auth middleware, `owner_id` stays
      `NULL`
- [ ] React: drawing list page, editor page, Excalidraw embed, autosave with
      debounce, save-status UI, routing (`/`, `/drawings/:id`,
      `/drawings/new`)
- [ ] `compose.yaml` — Postgres only (Mode A)
- [ ] `.env.example`
- [ ] `Dockerfile` (multi-stage: Node build → Rust build → slim runtime,
      single production image)
- [ ] `README.md`

### v0.2 — Kubernetes

- [ ] `helm/excalistore/` chart: `Chart.yaml`, `values.yaml`, `deployment.yaml`,
      `service.yaml`, `ingress.yaml`, `migration-job.yaml`
- [ ] Production configuration via generic `values.yaml`
- [ ] CI/CD: build, test, scan, publish (image + chart, versioned releases)

### v0.3 — Authentication

- [ ] `AuthContext` extractor with `AUTH_MODE=dev|jwt` switch
- [ ] Hard guard preventing `AUTH_MODE=dev` in production
- [ ] JWT validation against Keycloak JWKS (or header-mode trust boundary,
      per §8 decision)
- [ ] `drawing_permissions` table + migration (`002_add_permissions`)
- [ ] Keycloak realm export fixture (`keycloak/realm-export.json`)
- [ ] Full Mode B compose stack (Postgres + Keycloak + oauth2-proxy + app)
- [ ] `owner_id` populated from `sub` claim on drawing creation
- [ ] Helm: oauth2-proxy sidecar/config, Keycloak client secret via K8s
      `Secret`

### v0.4+ — Collaboration (only if actually needed, not currently planned)

```
Excalidraw
     │
     ├── REST → ExcaliStore → PostgreSQL
     │
     └── WebSocket → excalidraw-room (added without replacing core design)
```

No work planned here unless a real requirement emerges.

---

## 17. Effort Estimates (reference only — see also §16 status)

Original estimate (human, no AI-assisted coding): **~1–2 weeks** for the full
MVP through v0.2, assuming reasonable Rust/Kubernetes familiarity.

| Component | Effort |
|---|---|
| React + Excalidraw | 2–4 days |
| Rust/Axum API | 1–3 days |
| PostgreSQL persistence | ~0.5–1 day |
| SQLx migrations | ~0.5 day |
| Autosave/versioning | 1–2 days |
| Kubernetes/Helm | 1–2 days |
| Docker Compose | ~0.5 day |
| CI/testing/hardening | 2–5 days |

**Revised estimate using Claude Code** for scaffolding/boilerplate/mechanical
work (migrations, Axum routes, React components, Dockerfile, Helm templates,
CI config), with a human steering/reviewing/testing: v0.1 (persistence MVP,
no auth) realistically **1–3 focused days**. v0.2/v0.3 compress similarly
since they're also largely mechanical once the design (this document) is
settled.

Caveat: this assumes active review of diffs and real testing against a real
Postgres instance — not fire-and-forget generation. Multi-service projects
like this can accumulate small inconsistencies (e.g. API contract drift
between frontend and backend) if unsupervised.

---

## 18. Key Architectural Decisions (summary)

1. Build a small custom wrapper rather than adopt an existing
   Excalidraw-persistence project — full control, minimal trust surface.
2. React for the frontend — Excalidraw is natively a React component.
3. Keep the frontend thin — routing, list UI, API calls, autosave state only.
4. Rust (Axum + SQLx + PostgreSQL) for the backend.
5. Store Excalidraw scenes as opaque JSONB — no relational modeling of scene
   internals.
6. Add optimistic versioning from day one — prevents silent overwrites
   without needing real-time collaboration.
7. Use SQLx migrations (plain SQL, Alembic-equivalent) over an ORM.
8. Keycloak is optional — the app must work without it.
9. If auth is needed, use an external proxy (oauth2-proxy) + Keycloak via
   Authorization Code Flow with PKCE — never build OIDC logic into the app
   itself.
10. No live collaboration (`excalidraw-room`) in v1.
11. One Git repository for frontend, API, migrations, Helm, and CI.
12. One production container — Rust serves both the compiled frontend and
    `/api/*`. Database is the only separate service.
13. Docker Compose included for local dev and integration testing, with two
    distinct modes (bare Postgres vs. full auth stack).
14. Helm chart is generic and can be public; company-specific deployment
    config stays in a private repo.
15. `owner_id` (and any future permission `principal`) is always keyed on the
    Keycloak `sub` claim, never username or email.
16. A dev-mode `AuthContext` stub (`AUTH_MODE=dev`) allows permission logic to
    be developed without running the full Keycloak stack, with a hard guard
    against it ever running in production.

---

## 19. Overall Philosophy

The design is intentionally boring and incremental:

```
React + Excalidraw + Rust + Postgres + Docker + Helm
```

...optionally adding:

```
+ oauth2-proxy + Keycloak       (v0.3, only if auth is needed)
```

...and only if a real requirement later emerges:

```
+ excalidraw-room                (v0.4+, not currently planned)
```

Each component has a clearly scoped responsibility, and nothing is built
ahead of an actual need — auth, permissions, and collaboration can all be
added later without discarding the core persistence/architecture design.

---

## 20. Immediate Next Step

Begin v0.1 implementation in this order:

1. `api/migrations/001_create_drawings.{up,down}.sql`
2. `api/src/main.rs` — Axum app setup, router, SQLx pool
3. `api/src/drawings.rs` — CRUD handlers incl. optimistic-versioned update
4. `api/src/error.rs` — error type + `IntoResponse` mapping (404, 409, 500)
5. `compose.yaml` (Postgres only) + `.env.example`
6. `frontend/` — Vite + React + TypeScript scaffold, Excalidraw embed,
   routing, drawing list, autosave
7. `Dockerfile` — multi-stage build producing the single production image
8. `README.md`

No auth, no Kubernetes, no Keycloak until this is working end-to-end locally.
