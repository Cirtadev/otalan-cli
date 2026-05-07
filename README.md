# `@otalan/cli`

Otalan CLI for bundling and publishing OTA update releases for Capacitor and Expo / React Native apps.

Website: [otalan.com](https://otalan.com)

Published as an npm package, but the CLI itself runs on Bun.

## Requirements

- Bun `>= 1.3.11` installed and available on your `PATH`
- An Otalan **CI key** for commands that talk to the Otalan API

Do not use the OTA app key in the CLI.

## Platform Support

The npm package ships a Bun-based CLI entrypoint, not standalone native binaries.

- macOS and Linux are supported when Bun `>= 1.3.11` is installed.
- Windows support is experimental until the CLI release flow is validated on Windows.
- Native compile scripts exist for macOS, Linux, and Windows maintainers, but the compiled binaries are not included in the npm package.

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

1. Log in with your CI key:

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

### Expo / React Native

1. Log in with your CI key:

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

`otalan bundle --target expo` runs `bunx expo export` itself, exports into a temporary project-local `.otalan/expo-export-*` folder, packages the exported JS bundle and assets, and stores the resolved Expo config in the Otalan manifest for publish. You do not need to create a `dist/` or `www/` folder before running it.
`otalan publish` waits for server-side validation to finish before it returns.

## CI/CD Usage

The CLI is designed to work well in CI/CD with a project-scoped Otalan CI key.

Set these secrets in your CI provider:

- `OTALAN_API_KEY`
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

### CI/CD Example: Expo / React Native

```bash
bun install --frozen-lockfile
bun add -g @otalan/cli
otalan login --api-key "$OTALAN_API_KEY" --api-url "${OTALAN_API_URL:-https://api.otalan.com}"
otalan init --app-id "$OTALAN_APP_ID"
otalan bundle --target expo --platform ios --bundle-from-package
otalan publish --channel production
```

This runs `bunx expo export` through the CLI, using a temporary project-local `.otalan/expo-export-*` folder, packages the exported OTA assets, and publishes the resulting bundle through Otalan's validation pipeline. Do not add a separate web build step just to create `dist/` or `www/` for Expo / React Native.

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
- Expo / React Native: remove the web build step if not needed and use `--target expo`

## What It Does

- logs into the Otalan API
- checks API connectivity and CI key context
- generates CI and OTA key material locally for dashboard import
- links the current repo to an Otalan app
- bundles Capacitor or Expo / React Native OTA output
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
  "appId": "com.example.app"
}
```

`otalan.config.json` only links the repo to an Otalan project/app. Bundle and release targeting data such as `target`, `platform`, `nativeVersion`, and `bundleId` live in `.otalan/bundle/manifest.json`.

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

If `--kind` is omitted, the CLI prompts for `CI key (private)` or `OTA key (public)`.

Output includes both the full Otalan key and the base64url suffix without the `otalan_ci_` or `otalan_ota_` prefix:

```text
Generated CI key.

Full key:
otalan_ci_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

Key without prefix:
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

`otalan keygen` only creates local key material. Importing or activating a key should still happen through an authenticated dashboard flow; an existing CI key should not be able to create more keys.

### `otalan login`

Saves the project CI key and API base URL locally.

If auth is already saved, `otalan login` shows the current API URL as the prompt default and shows the current CI key in masked form. Press Enter to keep either value.

```bash
otalan login --api-key otalan_ci_xxx --api-url https://api.otalan.com
```

### `otalan doctor`

Checks API connectivity and prints the organization/project context resolved from the configured CI key.

```bash
otalan doctor
```

CI usage without saved local auth:

```bash
otalan doctor --api-key "$OTALAN_API_KEY" --api-url "${OTALAN_API_URL:-https://api.otalan.com}"
```

### `otalan init`

Creates `otalan.config.json` in the current project.

`otalan init` lists the active apps in the project resolved from the logged-in CI key and lets you select one. `appId` is scoped to that project, not globally unique across all projects. Archived apps are not listed and are treated as unavailable for CI publish, rollback, status, and bundle listing commands.

Run `otalan init` once per app repo or working folder. If you switch to another checkout, folder, or app project, run `otalan init` there too so that folder has its own `otalan.config.json`.

If you pass `--app-id`, the CLI validates that the app exists in the logged-in project before writing `otalan.config.json`. The CLI also stores `organizationSlug` and `projectSlug` from the CI key as a safety check.

```bash
otalan init
# Non-interactive CI usage:
otalan init \
  --app-id com.example.app
```

### `otalan bundle`

Builds `.otalan/bundle/bundle.zip` and `.otalan/bundle/manifest.json`.

`.otalan/` is generated output. Add it to your app repo's `.gitignore`; `otalan publish` reads the bundle files from the current CI workspace after `otalan bundle` runs.

Capacitor:

```bash
otalan bundle --target capacitor --platform ios
# Custom Capacitor web output folder:
otalan bundle --target capacitor --platform ios --input-dir build
```

Expo / React Native:

```bash
otalan bundle --target expo --platform ios
```

Current behavior:

- Capacitor packages prebuilt web assets; it does not run your app build command
- without `--input-dir`, Capacitor checks `dist/` first and then `www/`
- pass `--input-dir <path>` to package a different Capacitor web output folder
- Expo / React Native runs `bunx expo export --platform <platform>` into a temporary project-local `.otalan/expo-export-*` folder
- Expo / React Native does not require a prebuilt `dist/` or `www/` folder
- Expo stores the resolved Expo app config in `.otalan/bundle/manifest.json` so publish can forward it for `extra.expoClient`
- both outputs produce a ZIP plus `manifest.json`
- `--platform` is required so the CLI exports the selected platform and resolves the correct native/runtime version

Native version defaults:

- In an interactive terminal, `otalan bundle` prompts for the native version after showing the detected active native version.
- Capacitor iOS reads `CFBundleShortVersionString` from `Info.plist` and resolves `$(MARKETING_VERSION)` from the Xcode project when needed
- Capacitor Android reads `versionName` from `android/app/build.gradle` or `build.gradle.kts`
- Expo reads the selected platform version from Expo config and falls back to the top-level Expo `version`
- Expo runtimeVersion reads `--runtime-version`, Expo export metadata, or Expo config runtimeVersion policies/strings; if none are present, the CLI falls back to the resolved native version
- `--native-version` overrides auto-detection

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
- when `otalan login` and `otalan init` are configured, the prompt also shows the active published bundle ID for the selected platform/native version/channel
- published bundle hints use `--channel`, defaulting to `production`
- pressing Enter without a bundle ID keeps the automatic bundle ID behavior
- the CLI reads `nativeVersion` from the selected native platform and adds a short hash suffix
- example: `1.0.0-abc123def456`

If you want to take the bundle ID from `package.json` instead:

```bash
otalan bundle --target capacitor --platform ios --bundle-from-package
otalan bundle --target expo --platform ios --bundle-from-package
```

### `otalan publish`

Publishes the current bundle output with rollout metadata.

`otalan publish` uses the `bundleId`, `platform`, and `nativeVersion` already stored in `.otalan/bundle/manifest.json`. To release `1.0.5`, set it when you run `otalan bundle --bundle-id 1.0.5`.

Current behavior:

- `channel` is chosen at publish time
- publishes are mandatory by default
- default rollout is `100`
- `--platform` and `--native-version` can override the manifest, but only if they match it
- `--output-dir` lets you publish a bundle from a non-default folder
- `--rollout-percent` accepts an integer from `0` to `100`
- `--optional` marks the update as non-mandatory
- `--release-notes` attaches release notes to the published bundle
- Expo publish forwards the stored Expo app config when present
- Otalan validates the release ZIP before the publish completes

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

This uses `POST /v1/releases/create` and waits for `GET /v1/releases/ingests/:id` to reach `ready` before returning success.

If validation fails, `otalan publish` exits non-zero and prints the ingest failure reason when the API provides one. This makes the command safe to use directly in CI/CD pipelines.

### `otalan bundles`

Lists remote bundles for the current app so you can choose a bundle for rollback or rollout operations.

Default resolution order:

1. `--native-version`
2. `.otalan/bundle/manifest.json` if present and the manifest platform matches the selected platform
3. native version derived from the selected platform in the local app project
4. interactive prompt

```bash
otalan bundles --platform ios --channel production
```

### `otalan rollback`

Reactivates an older bundle for the same tuple.

`rollback` uses the same native-version default order as `bundles`. Pass `--native-version` if you want to override the detected default.

```bash
otalan rollback --bundle-id 1.0.0-web.1 --platform ios --channel production
```

### `otalan status`

Shows the active bundle for the selected release tuple.

`status` also uses the same native-version default order as `bundles`.

```bash
otalan status --platform ios --channel production
```

## Bundle Output

### Capacitor Manifest

```json
{
  "target": "capacitor",
  "hash": "sha256...",
  "nativeVersion": "1.0.0",
  "bundleId": "1.0.0-abcdef123456",
  "createdAt": "2026-04-07T12:00:00.000Z",
  "platform": "ios"
}
```

### Expo Manifest

```json
{
  "target": "expo",
  "hash": "sha256...",
  "nativeVersion": "1.0.0",
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
- Expo / React Native bundling uses `bunx expo ...`.
- Default API URL is `https://api.otalan.com`.
- Publishing, rollback, status, and `bundles` expect a CI key and an active app.
- Release commands print the organization and project resolved from the CI key before continuing.
- Run `bun run build` after changing CLI source if you want `dist/bin.js` updated locally.
