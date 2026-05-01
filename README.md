# `@otalan/cli`

Otalan CLI for bundling and publishing OTA update releases for Capacitor and Expo / React Native apps.

Published as an npm package, but the CLI itself runs on Bun.

## Requirements

- Bun `>= 1.3.11` installed and available on your `PATH`
- An Otalan **CI key**

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
otalan init --app-id com.example.app
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

`otalan bundle --target capacitor` packages the built web assets from `dist/` or `www/`, so your app build must run first.
`otalan publish` waits for server-side validation to finish before it returns.

### Expo / React Native

1. Log in with your CI key:

```bash
otalan login --api-key otalan_ci_xxx
```

2. Link the current repo to your active Otalan app:

```bash
otalan init --app-id com.example.app
```

3. Bundle the OTA payload:

```bash
otalan bundle --target expo --platform ios --bundle-id 1.0.5
```

4. Publish the release:

```bash
otalan publish --channel production
```

`otalan bundle --target expo` runs `bunx expo export`, packages the exported JS bundle and assets, and stores the resolved Expo config in the Otalan manifest for publish.
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
bun run build
otalan login --api-key "$OTALAN_API_KEY" --api-url "${OTALAN_API_URL:-https://api.otalan.com}"
otalan init --app-id "$OTALAN_APP_ID"
otalan bundle --target capacitor --platform ios --bundle-from-package
otalan publish --channel production
```

Use your normal app build command before `otalan bundle`. The CLI then packages the built web output from `dist/` or `www/`.

### CI/CD Example: Expo / React Native

```bash
bun install --frozen-lockfile
otalan login --api-key "$OTALAN_API_KEY" --api-url "${OTALAN_API_URL:-https://api.otalan.com}"
otalan init --app-id "$OTALAN_APP_ID"
otalan bundle --target expo --platform ios --bundle-from-package
otalan publish --channel production
```

This runs `bunx expo export` through the CLI, packages the exported OTA assets, and publishes the resulting bundle through Otalan's validation pipeline.

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
  "organizationSlug": "test-org-407b69f7",
  "projectSlug": "test-project-ca3bcb8a",
  "appId": "com.example.app"
}
```

`otalan.config.json` only links the repo to an Otalan project/app. Bundle and release targeting data such as `target`, `platform`, `nativeVersion`, and `bundleId` live in `.otalan/bundle/manifest.json`.

## Command Reference

### `otalan help`

Shows the available commands.

### `otalan login`

Saves the CI key and API base URL locally.

```bash
otalan login --api-key otalan_ci_xxx --api-url https://api.otalan.com
```

Local development:

```bash
otalan login --api-key otalan_ci_xxx --api-url http://localhost:8787
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

`appId` is the registered app ID shown under the app name on the Apps page in Otalan. It is scoped to the current project, not globally unique across all projects. The app must be active; archived apps are treated as unavailable for CI publish, rollback, status, and bundle listing commands.

If you already ran `otalan login`, the CLI resolves `organizationSlug` and `projectSlug` automatically from the CI key and stores them as a safety check.

```bash
otalan init \
  --app-id app.cryptosan.app
```

### `otalan bundle`

Builds `.otalan/bundle/bundle.zip` and `.otalan/bundle/manifest.json`.

Capacitor:

```bash
otalan bundle --target capacitor --platform ios
```

Expo / React Native:

```bash
otalan bundle --target expo --platform ios
```

Current behavior:

- Build your Capacitor web assets before running `otalan bundle`
- Capacitor reads `dist/` or `www/`
- Expo runs `bunx expo export --platform <platform>`
- Expo stores the resolved Expo app config in `.otalan/bundle/manifest.json` so publish can forward it for `extra.expoClient`
- both outputs produce a ZIP plus `manifest.json`
- `--platform` is required so the CLI exports the selected platform and resolves the correct native/runtime version

Native version defaults:

- Capacitor iOS reads `CFBundleShortVersionString` from `Info.plist` and resolves `$(MARKETING_VERSION)` from the Xcode project when needed
- Capacitor Android reads `versionName` from `android/app/build.gradle` or `build.gradle.kts`
- Expo reads the selected platform version from Expo config and falls back to the top-level Expo `version`
- Expo runtimeVersion reads `--runtime-version`, Expo export metadata, or Expo config runtimeVersion policies/strings
- `--native-version` overrides auto-detection

Choose the bundle ID you want to release:

```bash
otalan bundle --target capacitor --platform ios --bundle-id 1.0.5
otalan bundle --target expo --platform ios --bundle-id 1.0.5
```

`bundleId` is the customer-facing OTA release identifier for all targets. The CLI maps it to the target-specific metadata internally.

If you omit `bundleId`:

- the CLI reads `nativeVersion` from the selected native platform and adds a short hash suffix
- example: `1.0.0-abc123def456`

If you want to take the bundle ID from `package.json` instead:

```bash
otalan bundle --target capacitor --platform ios --bundle-from-package
```

### `otalan publish`

Publishes the current bundle output with rollout metadata.

`otalan publish` uses the `bundleId`, `platform`, and `nativeVersion` already stored in `.otalan/bundle/manifest.json`. To release `1.0.5`, set it when you run `otalan bundle --bundle-id 1.0.5`.

Current behavior:

- `channel` is chosen at publish time
- `--platform` and `--native-version` can override the manifest, but only if they match it
- `--output-dir` lets you publish a bundle from a non-default folder
- Expo publish forwards the stored Expo app config when present
- Otalan validates the release ZIP before the publish completes

Default flow:

```bash
otalan publish --channel production
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
- Local development API URL is `http://localhost:8787`.
- Publishing, rollback, status, and `bundles` expect a CI key and an active app.
- Run `bun run build` after changing CLI source if you want `dist/bin.js` updated locally.
