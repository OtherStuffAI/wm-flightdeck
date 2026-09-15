# Playwright Performance Baseline

Status: Informational baseline
Date: 2026-09-15

Run the browser performance baseline with:

```bash
PLAYWRIGHT_DISABLE_VIDEO=1 bun run test:e2e:perf
```

The spec seeds synthetic chat, task, document, scope, flow, and opportunity rows
inside the Alpine store after the app shell is ready. It does not require a live
Tower. The heavy-state defaults are 2,000 tasks, 2,000 documents, and 800 thread
replies; override them with `FLIGHTDECK_PERF_TASKS`, `FLIGHTDECK_PERF_DOCS`, and
`FLIGHTDECK_PERF_HISTORY`.

## First Local Baseline

Measured on local Chromium through Playwright:

| Scenario | Readiness | Exact typing | Latency | Frame/long-task signal |
| --- | --- | --- | --- | --- |
| Chat composer, 200 tasks/docs and 120 replies | shell 780 ms, composer 1,022 ms | 74/74 rendered characters | key-to-input p95 0.9 ms; key-to-render p95 215.6 ms | max frame gap 116.8 ms; 0 long tasks >50 ms |
| Heavy chat composer, 2,000 tasks/docs and 800 replies | shell 653 ms, composer 1,588 ms | 74/74 rendered characters | key-to-input p95 1.6 ms; key-to-render p95 231.2 ms | max frame gap 133.2 ms; 0 long tasks >50 ms |
| Seeded navigation, 2,000 tasks/docs and 800 replies | shell 733 ms, composer 1,729 ms | n/a | thread-open p95 145.8 ms; task-detail-open p95 499.8 ms | DOM 14,557 nodes after task detail |

The app's visible contenteditable value matched the expected typed value exactly
in both typing scenarios. The store `threadInput` value is logged as a diagnostic
because this harness reads it before the production send path normalizes the
composer model.

## Recommended Future Gates

Keep this baseline threshold-light until it has been sampled on CI and the
usual development machine. Reasonable first gates after a few runs:

- Always fail on dropped characters: rendered length and content must exactly
  match the typed string, and `beforeinput`/`input` counts must match.
- Heavy-state key-to-input p95 below 15 ms and max below 50 ms.
- Heavy-state key-to-render p95 below 350 ms and max below 600 ms.
- No more than two typing long tasks over 50 ms, and no typing long task over
  200 ms.
- Heavy-state composer readiness below 2,500 ms.
- Seeded thread-open p95 below 250 ms and task-detail-open p95 below 750 ms.
