# `@otalan/cli`

Otalan CLI for bundling and publishing OTA update releases for Capacitor and Expo apps.

Website: [otalan.com](https://otalan.com)

Published as an npm package, but the CLI itself runs on Bun.

## Requirements

- Bun `>= 1.3.11` installed and available on your `PATH`
- An Otalan **OTA Publish Key**, generated from the Otalan Dashboard, for commands that talk to the Otalan API

Otalan key prefixes are stable API identifiers:

- **OTA Publish Key** values use the `otalan_ci_` prefix internally.
- **OTA App Key** values use the `otalan_ota_` prefix internally.

Do not use an OTA App Key in the CLI. OTA App Keys can be embedded in mobile app code for update checks, but they should not be shared outside the app or used for release automation.

## Platform Support

The npm package ships a Bun-based CLI entrypoint, not standalone native binaries.

- macOS and Linux are supported when Bun `>= 1.3.11` is installed.
- Windows support is experimental until the CLI release flow is validated on Windows.
- Native compile scripts exist for macOS, Linux, and Windows maintainers, but the compiled binaries are not included in the npm package.

## App Framework Support

Officially supported app targets and versions:

- Capacitor 7 and 8 with `--target capacitor`
- Expo SDK 54, 55, and 56 with `--target expo`

Other app targets and older framework versions may work, but they are not officially supported for the moment.

## Install

Recommended:

```bash
bun add -g @otalan/cli
```

If you install the package with `npm`, `pnpm`, or `yarn`, `bun` still needs to be installed because the executable runs with `#!/usr/bin/env bun`.

Local development from this repo:

```bash
bun ./src/bin.ts help
```

## Quick Start

### Capacitor

1. Log in with your OTA Publish Key:

```bash
otalan login --api-key otalan_ci_xxx
```

2. Link the current repo to your active Otalan app:

```bash
otalan init
```

3. Build your web assets with your app's normal build command.

4. Bundle the OTA payload:

```bash
otalan bundle --target capacitor --platform ios --bundle-id 1.0.5
```

5. Publish the release:

```bash
otalan publish --channel production
```

`otalan bundle --target capacitor` packages existing built web assets. By default it reads `dist/` first, then `www/`; pass `--input-dir <path>` if your build outputs somewhere else. Your app build must run first.
`otalan publish` waits for server-side validation to finish before it returns.

### Expo

1. Log in with your OTA Publish Key:

```bash
otalan login --api-key otalan_ci_xxx
```

2. Link the current repo to your active Otalan app:

```bash
otalan init
```

3. Bundle the OTA payload:

```bash
otalan bundle --target expo --platform ios --bundle-id 1.0.5
```

4. Publish the release:

```bash
otalan publish --channel production
```

`otalan bundle --target expo` runs `bunx expo export` itself, exports into a temporary project-local `.otalan/expo-export-*` folder, packages the exported JS bundle and assets, and stores the generated Otalan satellite manifest for publish. You do not need to create a `dist/` or `www/` folder before running it.
`otalan publish` waits for server-side validation to finish before it returns.

## CI/CD Usage

The CLI is designed to work well in CI/CD with a project-scoped OTA Publish Key.

Set these secrets in your CI provider:

- `OTALAN_API_KEY` with your OTA Publish Key
- `OTALAN_APP_ID` for an active app

Optional:

- `OTALAN_API_URL`

### CI/CD Example: Capacitor

```bash
bun install --frozen-lockfile
bun add -g @otalan/cli
bun run build
otalan login --api-key "$OTALAN_API_KEY" --api-url "${OTALAN_API_URL:-https://api.otalan.com}"
otalan init --app-id "$OTALAN_APP_ID"
otalan bundle --target capacitor --platform ios --bundle-from-package
otalan publish --channel production
```

Use your normal app build command before `otalan bundle`. The CLI then packages the built web output from `dist/` or `www/` by default; pass `--input-dir <path>` if your Capacitor web output uses another folder.

### CI/CD Example: Expo

```bash
bun install --frozen-lockfile
bun add -g @otalan/cli
otalan login --api-key "$OTALAN_API_KEY" --api-url "${OTALAN_API_URL:-https://api.otalan.com}"
otalan init --app-id "$OTALAN_APP_ID"
otalan bundle --target expo --platform ios --bundle-from-package
otalan publish --channel production
```

This runs `bunx expo export` through the CLI, using a temporary project-local `.otalan/expo-export-*` folder, packages the exported OTA assets, and publishes the resulting bundle through Otalan's validation pipeline. Do not add a separate web build step just to create `dist/` or `www/` for Expo.

### GitHub Actions Example

```yaml
name: Publish OTA

on:
  workflow_dispatch:

jobs:
  publish-ios:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.11

      - run: bun install --frozen-lockfile
      - run: bun add -g @otalan/cli
      - run: bun run build
      - run: otalan login --api-key "$OTALAN_API_KEY"
        env:
          OTALAN_API_KEY: ${{ secrets.OTALAN_API_KEY }}
      - run: otalan init --app-id "$OTALAN_APP_ID"
        env:
          OTALAN_APP_ID: ${{ secrets.OTALAN_APP_ID }}
      - run: otalan bundle --target capacitor --platform ios --bundle-from-package
      - run: otalan publish --channel production
```

Adjust the build step and bundle target for your app:

- Capacitor: keep your web build step and use `--target capacitor`
- Expo: remove the web build step if not needed and use `--target expo`

## What It Does

- logs into the Otalan API
- checks API connectivity and OTA Publish Key context
- generates OTA Publish Key and OTA App Key material locally for dashboard import
- links the current repo to an Otalan app
- bundles Capacitor or Expo OTA output
- publishes a bundle with rollout metadata
- lists published bundles
- rolls back to an older bundle
- shows current bundle status

The CLI supports one release write path: `otalan publish`. There is no separate `upload` command.

## Config Files

Global auth config:

```text
~/.otalan/config.json
```

Project config:

```text
otalan.config.json
```

Example project config:

```json
{
  "organizationSlug": "example-organization",
  "projectSlug": "example-project",
  "appName": "Example App",
  "appId": "com.example.app"
}
```

`otalan.config.json` only links the repo to an Otalan project/app. Bundle and release targeting data such as `target`, `platform`, `runtimeVersion`, and `bundleId` live in `.otalan/bundle/manifest.json`.

## Command Reference

### `otalan help`

Shows the available commands and usage notes. Running `otalan` without arguments prints the same concise command list and notes.

### `otalan version`

Prints the installed CLI version.

```bash
otalan version
otalan --version
otalan -v
```

### `otalan keygen`

Generates Otalan key material locally without calling the API. Use this for workflows where a team wants to create the key in its own terminal, CI setup, or secrets manager before importing it in the Otalan dashboard.

```bash
otalan keygen --kind ci
otalan keygen --kind ota
```

If `--kind` is omitted, the CLI prompts for `OTA Publish Key` or `OTA App Key`.

The `--kind` values and generated key prefixes keep the existing internal API identifiers:

- `--kind ci` generates an OTA Publish Key with the `otalan_ci_` prefix.
- `--kind ota` generates an OTA App Key with the `otalan_ota_` prefix.

Output includes both the full Otalan key and the base64url suffix without the `otalan_ci_` or `otalan_ota_` prefix:

```text
✓ Generated OTA Publish Key

┌────────────────┬────────────────────────────────────────────┐
│ Full key       │ otalan_ci_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx │
│ Without prefix │ xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx           │
└────────────────┴────────────────────────────────────────────┘
```

`otalan keygen` only creates local key material. Importing or activating a key should still happen through an authenticated dashboard flow; an existing OTA Publish Key should not be able to create more keys. OTA App Keys are intended for embedded app update checks and should not be shared or used as CLI credentials.

### `otalan login`

Saves the project OTA Publish Key and API base URL locally.

Otalan's default API URL is `https://api.otalan.com`. Only pass `--api-url` for self-hosted or non-production API environments.

If auth is already saved, `otalan login` shows the current API URL as the prompt default and shows the current OTA Publish Key in masked form.

During interactive login, typed OTA Publish Key characters are echoed as `*` so the terminal shows input progress without exposing the key.

```bash
otalan login --api-key otalan_ci_xxx
```

### `otalan doctor`

Checks API connectivity and prints the organization/project context resolved from the configured OTA Publish Key.

```bash
otalan doctor
```

CI usage without saved local auth:

```bash
otalan doctor --api-key "$OTALAN_API_KEY" --api-url "${OTALAN_API_URL:-https://api.otalan.com}"
```

### `otalan init`

Creates `otalan.config.json` in the current project.

`otalan init` lists the active apps in the project resolved from the logged-in OTA Publish Key and lets you select one. `appId` is scoped to that project, not globally unique across all projects. Archived apps are not listed and are treated as unavailable for CI publish, rollback, status, and bundle listing commands.

Run `otalan init` once per app repo or working folder. If you switch to another checkout, folder, or app project, run `otalan init` there too so that folder has its own `otalan.config.json`.

If you pass `--app-id`, the CLI validates that the app exists in the logged-in project before writing `otalan.config.json`. The CLI also stores `organizationSlug`, `projectSlug`, and the selected app name as a safety check and display context.

```bash
otalan init
# Non-interactive CI usage:
otalan init \
  --app-id com.example.app
```

### `otalan bundle`

Builds `.otalan/bundle/bundle-<bundle-id>.zip` and `.otalan/bundle/manifest.json`.

`.otalan/` is generated output. Add it to your app repo's `.gitignore`; `otalan publish` reads the bundle files from the current CI workspace after `otalan bundle` runs.

Capacitor:

```bash
otalan bundle --target capacitor --platform ios
# Custom Capacitor web output folder:
otalan bundle --target capacitor --platform ios --input-dir build
```

Expo:

```bash
otalan bundle --target expo --platform ios
```

Current behavior:

- Official support covers Capacitor 7 and 8, and Expo SDK 54, 55, and 56
- Other app targets and older framework versions may work, but they are not officially supported for the moment
- Capacitor packages prebuilt web assets; it does not run your app build command
- without `--input-dir`, Capacitor checks `dist/` first and then `www/`
- pass `--input-dir <path>` to package a different Capacitor web output folder
- Expo runs `bunx expo export --platform <platform>` into a temporary project-local `.otalan/expo-export-*` folder
- Expo does not require a prebuilt `dist/` or `www/` folder
- Expo stores the generated Otalan satellite manifest in `.otalan/bundle/manifest.json`, including `launchAsset`, `assets`, `runtimeVersion`, `bundleId`, and `expoConfig`
- both outputs produce a ZIP plus `manifest.json`
- default output uses colorized compact terminal UI symbols, shows animated status icons in interactive terminals, ends with `✓ Bundle created`, and prints the generated bundle folder as a compact table
- `--verbose` or `-v` prints the linked project/app, streams Expo subprocess output, shows the Capacitor build reminder, source-map omitted count, bundle ID source, and JSON bundle result
- source map files (`*.map`) are omitted from bundle ZIPs by default
- native project/source files are rejected before bundle output is written; OTA bundles must only contain generated web/update assets
- when `otalan login` and `otalan init` are configured, the CLI checks that the selected `bundleId` is not already published for the selected platform, runtimeVersion, and channel before writing bundle output
- `--platform` is required so the CLI exports the selected platform and resolves the correct runtime version

Runtime version defaults:

- In an interactive terminal, `otalan bundle` prompts for the runtime version after showing the detected active runtime version.
- Capacitor iOS defaults runtimeVersion from `CFBundleShortVersionString` in `Info.plist` and resolves `$(MARKETING_VERSION)` from the Xcode project when needed
- Capacitor Android defaults runtimeVersion from `versionName` in `android/app/build.gradle` or `build.gradle.kts`
- Expo runtimeVersion reads `--runtime-version`, Expo export metadata, or Expo config runtimeVersion policies/strings; if none are present, the CLI falls back to the selected platform Expo `version`
- `--runtime-version` overrides auto-detection

Native project file parsing is best-effort. If your `Info.plist`, Xcode build settings, or Gradle files use patterns the CLI cannot read, pass `--runtime-version` explicitly.

For Expo projects, the recommended app config is:

```json
{
  "expo": {
    "version": "1.0.0",
    "runtimeVersion": {
      "policy": "appVersion"
    }
  }
}
```

Use a string value instead if you manage runtime compatibility manually:

```json
{
  "expo": {
    "runtimeVersion": "1.0.0"
  }
}
```

Choose the bundle ID you want to release:

```bash
otalan bundle --target capacitor --platform ios --bundle-id 1.0.5
otalan bundle --target expo --platform ios --bundle-id 1.0.5
```

`bundleId` is the customer-facing OTA release identifier for all targets. The CLI maps it to the target-specific metadata internally.

If you omit `bundleId`:

- in an interactive terminal, the CLI prompts for a bundle ID and shows the local bundle ID from `.otalan/bundle/manifest.json` when available
- when `otalan login` and `otalan init` are configured, the prompt prints the latest 20 published bundles for the selected platform/runtime version/channel and also shows the active or latest published bundle ID
- published bundle hints use `--channel`, defaulting to `production`
- duplicate published bundle ID checks use the same `--channel` value and default to `production`
- pressing Enter without a bundle ID keeps the automatic bundle ID behavior
- the CLI reads `runtimeVersion` from the selected platform and adds a short hash suffix
- example: `1.0.0-abc123def456`

If you want to take the bundle ID from `package.json` instead:

```bash
otalan bundle --target capacitor --platform ios --bundle-from-package
otalan bundle --target expo --platform ios --bundle-from-package
```

### `otalan publish`

Publishes the current bundle output with rollout metadata.

`otalan publish` uses the `bundleId`, `platform`, and `runtimeVersion` stored in `.otalan/bundle/manifest.json`. To release `1.0.5`, set it when you run `otalan bundle --bundle-id 1.0.5`.

Current behavior:

- `channel` is chosen at publish time
- publishes are mandatory by default
- default rollout is `100`
- `--platform` and `--runtime-version` can override the manifest, but only if they match it
- `--output-dir` lets you publish a bundle from a non-default folder
- `--rollout-percent` accepts an integer from `0` to `100`
- `--optional` marks the update as non-mandatory
- `--release-notes` attaches release notes to the published bundle
- default output shows the app, bundle, platform/channel/runtime tuple, rollout, archive, and validation result, then ends with `✓ Release is Live`; `--verbose` or `-v` also prints the full project and ingest details as compact tables
- Expo publish forwards the full generated Otalan satellite manifest when present
- Expo publish sends the generated manifest with `runtimeVersion`
- Expo manifests include the Expo config captured from `bunx expo config --json`; avoid placing secrets in Expo config fields that are not intended to be uploaded
- Otalan validates the release ZIP before the publish completes
- active rollouts can be paused and resumed later without changing the selected bundle

Default flow:

```bash
otalan publish --channel production
```

Staged rollout:

```bash
otalan publish --channel production --rollout-percent 25 --release-notes "Fix startup crash"
```

Optional update:

```bash
otalan publish --channel production --optional
```

This uses the direct-upload release flow:

1. `POST /v1/releases/create` with JSON metadata for the release and local ZIP, including `expoManifest` for Expo bundles
2. `PUT` the ZIP bytes directly to the returned opaque `uploadUrl` with the exact returned `uploadHeaders`, including `Content-Length`
3. `POST /v1/releases/ingests/:id/complete`
4. poll `GET /v1/releases/ingests/:id` until the ingest reaches `ready` or `failed`

If the direct object-storage upload fails before completion, the CLI calls `POST /v1/releases/ingests/:id/cancel` so the reserved ingest does not block a retry.

The ZIP is opened as a disk-backed `Bun.file` and passed directly to the returned `PUT` upload URL; `otalan publish` does not load the full archive into memory first.

If validation fails, `otalan publish` exits non-zero and prints the ingest failure reason when the API provides one. This makes the command safe to use directly in CI/CD pipelines.

### `otalan channels`

Prints the resolved organization/project context, then lists distinct release channels for the project resolved from the configured OTA Publish Key. This command does not require `otalan init`.

```bash
otalan channels
otalan channels --app-id com.example.app
```

When `--app-id` is omitted in an interactive terminal, the CLI prompts for an app filter with `All` selected by default. Non-interactive runs default to `All`.

The command uses `GET /v1/releases/channels`, optionally with `?appId=...`, and prints each returned channel with the apps that use it in a compact table:

```json
{
  "items": [
    {
      "channel": "production",
      "apps": [
        { "appId": "com.example.app", "name": "Example App" }
      ]
    }
  ]
}
```

### `otalan bundles`

Lists remote bundles for the current app so you can choose a bundle for rollback or rollout operations.

Remote bundle tables are colorized and display the API `publishedAt` timestamp, not the bundle row `createdAt` timestamp.

The active bundle row is highlighted in green.

Bundle lists are paginated by the API. When `--page` and `--page-size` are omitted, Otalan returns page 1 with 20 bundles. `--page-size` is capped at 100.

Default resolution order:

1. `--runtime-version`
2. `.otalan/bundle/manifest.json` if present and the manifest platform matches the selected platform
3. runtime version derived from the selected platform in the local app project
4. interactive prompt

```bash
otalan bundles --platform ios --channel production
otalan bundles --platform ios --channel production --page 2 --page-size 50
```

### `otalan rollback`

Reactivates an older bundle for the same tuple.

`rollback` uses the same runtime-version default order as `bundles`. Pass `--runtime-version` if you want to override the detected default.
If `--bundle-id` is omitted, interactive terminals show a paginated selectable bundle list. The current live bundle is highlighted in green and disabled; deleted or unavailable archives are also disabled. Use `--page` and `--page-size` to choose which rollback candidates to display.

```bash
otalan rollback --bundle-id 1.0.0-web.1 --platform ios --channel production
otalan rollback --platform ios --channel production --page 2 --page-size 50
```

When no bundles exist for the selected platform, channel, and runtimeVersion, `otalan rollback` exits without prompting for a target bundle. Successful rollbacks print `Bundle selected`, the selected bundle summary, and then `✓ Rollback done`.

### `otalan pause`

Pauses delivery of the currently active bundle for the selected release tuple.

`pause` uses the same runtime-version default order as `bundles`. The active bundle remains selected, but new OTA checks stop receiving it until you resume the rollout.

```bash
otalan pause --platform ios --channel production
```

### `otalan resume`

Resumes delivery of the currently active bundle for the selected release tuple.

`resume` uses the same runtime-version default order as `bundles`.

```bash
otalan resume --platform ios --channel production
```

### `otalan status`

Shows the active bundle for the selected release tuple.

The active bundle summary displays `publishedAt` as `Published at`.

`status` also uses the same runtime-version default order as `bundles`.

```bash
otalan status --platform ios --channel production
```

## Bundle Output

### Capacitor Manifest

```json
{
  "target": "capacitor",
  "hash": "sha256...",
  "runtimeVersion": "1.0.0",
  "bundleId": "1.0.0-abcdef123456",
  "createdAt": "2026-04-07T12:00:00.000Z",
  "platform": "ios"
}
```

### Expo Satellite Manifest

```json
{
  "target": "expo",
  "hash": "sha256...",
  "runtimeVersion": "1.0.0",
  "bundleId": "1.0.0-abcdef123456",
  "launchAsset": "bundles/ios-xxxxx.js",
  "assets": [
    "assets/asset_1.png"
  ],
  "expoConfig": {
    "name": "Example",
    "slug": "example",
    "scheme": "example"
  },
  "createdAt": "2026-04-07T12:00:00.000Z",
  "platform": "ios"
}
```

For Expo publishes, `otalan publish` serializes this file and sends it to `/v1/releases/create` as `expoManifest`.

## Maintainer Release Checklist

Before publishing a public package release:

- update `package.json` to the new package version
- add the matching `CHANGELOG.md` entry
- run the release checks and inspect the package dry run

```bash
bun install --frozen-lockfile
bun test
bun run check
bun run lint
bun run build
bun pm pack --dry-run
```

`prepublishOnly` reruns tests, TypeScript, and ESLint. The scoped npm package is configured for public publishing through `publishConfig.access`.

## Notes

- This is a Bun-based CLI published on npm.
- Terminal prompts, loading indicators, and interactive status rendering use `@clack/prompts`; command summaries and list commands use compact colorized tables.
- Set `OTALAN_NO_COLOR=1` if you need plain, non-colorized logs.
- Expo bundling uses `bunx expo ...`.
- Default API URL is `https://api.otalan.com`.
- Publishing, rollback, status, and `bundles` expect an OTA Publish Key and an active app.
- Bundle and release commands print the linked project and app before continuing when project config is available.
- Run `bun run build` after changing CLI source if you want `dist/bin.js` updated locally.
