# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-04

Persistence MVP: save and reopen Excalidraw drawings, no authentication yet.

### Added

- REST API for drawings — create, list, get, update, delete — backed by
  PostgreSQL, with optimistic-concurrency versioning on updates.
- React + Excalidraw frontend: a drawing list page and an editor page with
  the Excalidraw canvas embedded, routed at `/`, `/drawings/:id`,
  `/drawings/new` (and `/new`).
- Autosave: scene edits save automatically after a short debounce, with a
  save-status indicator (`⟳ Saving…` / `✓ Saved` / `⚠ Save failed`).
- Editor toolbar: a back link to the drawing list, and an inline, click-to-
  edit drawing title.
- Prometheus metrics endpoint and request tracing.
- A single production Docker image (multi-stage build: frontend → API →
  slim runtime) serving the built frontend as static files with SPA
  fallback, plus a `docker compose` setup — Postgres alone for day-to-day
  development, or the full app for container/integration testing.
- `README.md` with run, API, test, and container instructions.

### Fixed

- An infinite-render crash on the editor page.
- Autosave no longer fires (and bumps the drawing's version) for
  Excalidraw's own selection/tool/scroll change events — only an actual
  edit to the scene triggers a save.
- `/new` now works as a direct route, not just `/drawings/new`.
- Title edits are no longer silently lost: they save immediately instead of
  riding the debounced scene-autosave, so committing a title and
  immediately navigating away — or clicking straight into the Excalidraw
  canvas, which suppresses the title input's blur event — no longer drops
  the change.

[Unreleased]: https://github.com/fgoessl/excalistore/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/fgoessl/excalistore/releases/tag/v0.1.0
