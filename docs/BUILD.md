# Build and Packaging Guide

## Purpose

This guide describes the repository’s actual build workflow. It covers local installation, automated validation, the configured Linux artifact, and the Windows ZIP process used for manual validation. It does not claim that a cross-packaged ZIP has been executed or accepted on Windows.

## Prerequisites

| Requirement | Why it is needed |
|---|---|
| Node.js and npm | Runs the React build, Electron tooling, test runner, and electron-builder. |
| Installed dependencies | Provides Electron, Vite, steamworks.js, tests, and packaging tools. |
| Git working tree | Required to obtain an unambiguous commit SHA for test artifacts. |
| Steam on the validation machine | Required only for live Steamworks-backed manual checks. |
| Steam Web API key | Required for library and remote verification features during relevant manual tests. |

The packaging environment may be Linux while the target artifact is Windows. That produces a package for Windows testing; it is **not** a substitute for launching it on Windows and observing the UI/Steam behavior.

## Install

```bash
npm install
```

Use the tracked `package-lock.json` to keep dependency resolution consistent. Do not manually edit dependencies or lockfile contents as part of ordinary packaging.

## Development commands

| Command | Purpose |
|---|---|
| `npm run dev` | Starts Vite and Electron for local development. |
| `npm run dev:diagnostics` | Starts the diagnostics-enabled development flow. |
| `npm test` | Runs `node --test tests/*.test.js`. |
| `npm run build:renderer` | Produces the Vite renderer build in `dist/`. |
| `npm run build` | Runs renderer build followed by configured electron-builder packaging. |

The configured `npm run build` produces the Linux target declared in `package.json` (`AppImage` at the time of this document). Confirm the build output rather than relying on a historical filename.

## Required pre-build checks

Before a build intended for sharing or manual validation:

```bash
git branch --show-current
git status --short
git diff --check
npm test
```

The active development branch should be `feature/humanized-scheduler` unless the assigned task explicitly changes it. The tree should be clean before final packaging. Do not package an unknown mixture of tracked and untracked changes.

## Version metadata

The package version is defined in `package.json`; the root package metadata in `package-lock.json` must match it. Verify both before release packaging:

```bash
node -e "const p=require('./package.json'); const l=require('./package-lock.json'); console.log({package:p.version, lock:l.version, lockRoot:l.packages[''].version});"
```

A version bump must be an explicit project change, not a workaround for creating another artifact. Maintain the version policy specified by the active task.

## Standard production build

```bash
npm run build
```

This executes:

```text
npm run build:renderer && electron-builder
```

The build configuration currently sets the product name to `Smart Steam Unlocker`, the Electron entrypoint to `electron/main.js`, and `release/` as the packaging output directory.

## Windows manual-validation ZIP

Create a SHA-stamped ZIP **after** the intended release commit exists. Obtain the short SHA from the committed feature branch:

```bash
SHORT_SHA="$(git rev-parse --short HEAD)"
VERSION="$(node -p "require('./package.json').version")"
```

Then run the Windows ZIP command:

```bash
npx electron-builder --win zip \
  --config.artifactName="Smart Steam Unlocker-\${version}-win-${SHORT_SHA}.\${ext}" \
  --config.extraMetadata.ssuBuildCommit="${SHORT_SHA}" \
  --config.win.signAndEditExecutable=false
```

The expected artifact pattern is:

```text
release/Smart Steam Unlocker-<VERSION>-win-<SHORT_SHA>.zip
```

For example, the v0.3.0 packaging pass produced:

```text
Smart Steam Unlocker-0.3.0-win-a9a85ed.zip
```

Do not overwrite earlier ZIPs. Preserve each artifact as evidence for the commit/version it represents.

## Verify artifact identity

### SHA-256

```bash
sha256sum "release/Smart Steam Unlocker-${VERSION}-win-${SHORT_SHA}.zip"
```

Record the complete checksum with the artifact name and full Git commit SHA.

### Embedded package metadata

The Windows package stores the application in `resources/app.asar`. electron-builder may rewrite the staging `package.json` to inject `ssuBuildCommit`; therefore, inspect the packaged archive rather than assuming local source metadata alone proves package identity.

One approach is to extract `resources/app.asar` from the ZIP and use the project’s installed `@electron/asar` module to read `package.json`. The expected values are:

```json
{
  "version": "<VERSION>",
  "ssuBuildCommit": "<SHORT_SHA>"
}
```

### Restore the source package file

The Windows packaging command may rewrite the repository’s `package.json` for staging metadata. After verifying the ZIP, restore the committed source file and confirm the worktree is clean:

```bash
git checkout -- package.json
git status --short
```

Do not commit the temporary stripped/re-written package file produced by packaging.

## Release hygiene checklist

| Check | Expected result |
|---|---|
| Branch | `feature/humanized-scheduler` for feature work. |
| Main | No direct commit, merge, reset, or other mutation. |
| Version | `package.json` and root `package-lock.json` match. |
| Tests | `npm test` passes. |
| Build | `npm run build` passes. |
| Artifact | New ZIP name includes version and short commit SHA. |
| Metadata | ZIP contains matching version and `ssuBuildCommit`. |
| Checksum | SHA-256 is recorded. |
| Source tree after packaging | Clean; packaging-only package mutation restored. |
| Windows acceptance | Reported separately and only after manual Windows evidence. |

## Environment limitations

A Linux build environment can create a Windows ZIP, but it cannot prove Windows runtime rendering, Steam client state, native Steamworks behavior, Accessibility, or Arabic/RTL layout acceptance. Run the Windows checklist in [TESTING.md](TESTING.md) on the target platform before calling an artifact accepted.
