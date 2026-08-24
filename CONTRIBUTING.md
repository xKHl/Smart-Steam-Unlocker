# Contributing

## Development branch policy

Active development occurs on:

```text
feature/humanized-scheduler
```

The default branch is `main`. Do **not** commit directly to `main`, merge PR #1, reset the feature branch, delete/rename branches, change the default branch, or rewrite useful project history unless an authorized maintainer explicitly directs that action.

Before work begins, confirm the current branch, HEAD, working tree, feature remote SHA, and `main` remote SHA:

```bash
git branch --show-current
git status --short
git rev-parse HEAD
git ls-remote origin refs/heads/feature/humanized-scheduler refs/heads/main
```

## Contribution expectations

A useful contribution is a focused, evidence-backed project change. Avoid empty commits, unrelated redesigns, speculative patches, broad reformatting, or version bumps made only to produce GitHub activity.

For a confirmed defect:

1. Reproduce or inspect credible evidence first.
2. Trace the existing flow from UI to IPC to owning service before changing it.
3. Explain the root cause in code terms.
4. Make the smallest safe fix.
5. Add or update a regression test.
6. Run the full test suite and build.
7. Update the relevant current documentation when behavior, validation, workflow, or invariants change.

Use concise, meaningful commits. Keep logically distinct documentation and product work separate when that improves history clarity.

## Mandatory validation

Run before finalizing a change:

```bash
git diff --check
npm test
npm run build
```

For a Windows-targeted change, produce a fresh commit-stamped ZIP and complete the relevant manual checklist in [docs/TESTING.md](docs/TESTING.md). A Linux build or a packaged ZIP alone does not prove Windows runtime acceptance.

## Humanized and achievement safety

The achievement paths are stateful. Preserve these rules:

- A Humanized schedule owns a single immutable App ID.
- The canonical ordering pipeline in `electron/humanized/ordering.js` remains the source of truth for grid, bulk-selection, and new-schedule ordering.
- Display sort changes do not mutate an existing persisted execution schedule.
- Execution acceptance and remote Steam verification are different states.
- Verification/recheck/recovery must not issue a speculative duplicate activation.
- A genuinely `running` Humanized schedule protects switching to another App ID. Paused, terminal, or stale recovered schedules must not incorrectly block normal Library selection.
- Keep operation leases coordinated across Instant, Humanized, and Relock.
- Relock is strictly per-achievement. Never use a global reset to implement it.
- Do not change scheduler timing just to compensate for a renderer countdown issue.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/AI_HANDOVER.md](docs/AI_HANDOVER.md), the owning source, and the focused tests before modifying these areas.

## Steam truthfulness and user safety

Do not fabricate, infer, or overstate:

- remote Steam confirmation from a local activation result;
- game-running/active state from a Steam URI launch request;
- Trading Card drops, remaining drops, exact drop timing, or playtime without supporting data;
- library/achievement/Integrity evidence absent from the actual response;
- an Integrity verdict of intent or legitimacy.

Preserve the distinction between Steam client connection, selected game context, local action result, remote Web API result, and user-visible Steam state.

## IPC, credentials, and security

- Keep Electron renderer code behind the restricted preload bridge.
- Validate any new IPC payload in `electron/ipc/validation.js` and register it narrowly in `electron/ipc/handlers.js`.
- Do not expose Node.js, filesystem, shell, raw Electron APIs, or stored plaintext credentials to renderer code.
- Keep Web API keys in the credential store. The renderer may submit replacement values but must not retrieve saved secret values.
- Keep `app:open-external` constrained to trusted, maintained URLs.
- Do not loosen CSP or sandbox/context-isolation settings without a security-specific review.

## Localization and RTL

All new visible product UI copy must use `src/i18n/translations.mjs`; do not insert Arabic text directly into JSX as a one-off fix. Add both English and Arabic keys.

Arabic is a first-class RTL layout, not only translated labels. In Arabic desktop mode, the visual structure is:

```text
[ Main Content ] [ Sidebar ]
```

The Sidebar must be on the right with the active indicator/border in the correct position. Preserve left-to-right rendering for technical values including URLs, App IDs, Steam IDs, achievement IDs, API keys, code, and Steam-returned identifiers. Do not translate Steam-provided game names or achievement names/descriptions.

Use exact required terminology where applicable:

| English concept | Required Arabic |
|---|---|
| Humanized Mode | `محاكاة الإنسان` |
| Relock | `إعادة قفل الإنجاز` |
| Unlock | `فتح الإنجاز` |
| Achievement Integrity | `سلامة الإنجازات` |
| Scan / Analyze / Explain | `فحص` / `تحليل` / `التفسير` |

Manually validate Arabic **and** the return to English for any UI/layout change.

## Trading Cards and Integrity

Trading Cards are independent from achievements and Humanized scheduling. Do not redesign the monitor into an unsupported process-idling system or claim it controls a game process.

Achievement Integrity is read-only, local, and descriptive. It must not unlock, write, submit, publish, or imply a definitive account judgment.

## Documentation requirements

Update documentation when a change affects any of the following:

- version/current status or validation evidence;
- architecture, IPC surface, security boundary, persistence format, or build process;
- manual validation requirements;
- source ownership or test suite structure;
- known limitations or handover constraints.

Keep [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) current. Preserve historical documents as historical evidence instead of deleting them solely because their version context is old.

## Pull requests

Use the existing PR from `feature/humanized-scheduler` to `main` unless a maintainer requests a different flow. The PR body should state scope, version, tested/build results, Windows validation status, remaining risks, and any manual evidence. Do not mark an item Windows-validated without actual Windows evidence.
