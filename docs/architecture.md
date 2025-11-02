# Architecture Overview

This document captures the initial topology for the BKAI EPUB reader so the
Agent teams can collaborate without stepping on each other's toes. It focuses
on current responsibilities and planned extension points.

## Crate Layout

- `main.rs` – bootstraps the application, hands the initial `ReaderState`
  to the UI runtime, and optionally opens an EPUB path passed on the CLI.
- `app` – lightweight orchestrator that wires parsing, state management,
  and the UI runtime together. This crate owns the happy-path control flow
  and keeps constructor logic in one place.
- `epub` – parsing layer that turns an `.epub` container into a normalized
  `Book`/`BookContent`/`Chapter` graph. The module currently relies on the
  `epub` crate plus a bespoke adapter that extracts structured blocks for
  rendering.
- `state` – holds high-level reading state (active book, chapter cursor) and
  navigation helpers. All mutations of the reading position should pass through
  this module to guarantee consistency once persistence lands.
- `ui` – gpui-based shell that renders the reader window, TOC, and active
  chapter view. It consumes the data prepared by `epub` and `state` and owns
  user interaction wiring (keyboard shortcuts, scroll synchronization, etc.).

## Cross-Module Data Contracts

- `BookModel` (`Book`, `Chapter`, `ChapterBlock`, `TextSpan`) is the shared
  vocabulary across parsing, state, rendering, and UI. Any new format support
  should translate content into this structure (or a compatible extension).
- `ReaderState` exposes simple chapter navigation primitives that the UI
  consumes. Future pagination work should extend this API rather than grabbing
  book internals directly.
- UI actions (chapter navigation, TOC jumps) are communicated through
  `ReaderState` mutations. When persistence is introduced, the storage layer
  can subscribe to the same mutation sites.

## Extension Points

- **Format Abstraction:** wrap the current `EpubService` behind a
  `FormatParser` trait to host EPUB now and MOBI/PDF later. The service
  already returns a `Book`, easing the swap.
- **Renderer/Pagination Agent:** once true pagination is available, expose a
  `Renderer` trait that takes a chapter (or chapter fragment) and produces a
  `PageView` consumed by gpui. Ensure the trait emits events that the UI can
  hook into for scroll synchronisation.
- **Storage Backend:** design a `StorageBackend` trait with a local file
  implementation first. The `ReaderState` setter methods are the natural hook
  to trigger persistence.
- **Event Bus:** the orchestrator can grow into a light command bus so new
  Agents (search, annotations) can react to state transitions without direct
  coupling.

## Tooling & QA Hooks

- Every module now has a `#[cfg(test)]` surface; keep augmenting them with
  regression cases (e.g. malformed OPF, missing TOC) as fixtures arrive.
- CI should run `cargo fmt`, `cargo clippy --all-targets --all-features`, and
  `cargo test`. Local scripts should set `TMPDIR` and `CARGO_HOME` to the
  workspace to play nicely with sandboxed environments.

## Near-Term Tasks

1. Pull the pagination/renderer skeleton into its own module (even if mocked)
   so the UI shell can depend on a stable trait.
2. Finalise the storage abstraction and wire it into `ReaderState` mutation
   sites.
3. Produce a small curated EPUB corpus under `fixtures/` for parser regression
   tests and manual QA.
