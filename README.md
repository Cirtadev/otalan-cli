# `@otalan/cli`

Otalan CLI for bundling and publishing OTA updates.

## What It Does

- logs into the Otalan API
- initializes local project config
- bundles Capacitor or Expo web output
- publishes a bundle
- lists remote bundles
- rolls back to an older bundle
- shows current bundle status

## Key Requirement

The CLI uses the **CI key**.

Do not use the OTA app key in the CLI.

## Install

```bash
bun add -g @otalan/cli
```

Or run it locally from this repo:

```bash
bun ./src/bin.ts help
```

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

## Commands

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

### `otalan init`

Creates `otalan.config.json` in the current project.

`appId` is the registered app ID shown under the app name on the Apps page in Otalan. It is scoped to the current project, not globally unique across all projects.

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

Expo:

```bash
otalan bundle --target expo --platform ios
```

Current behavior:

- Build your Capacitor web assets before running `otalan bundle`
- Capacitor reads `dist/` or `www/`
- Expo runs `bunx expo export`
- both outputs produce a ZIP plus `manifest.json`

Choose the bundle ID you want to publish:

```bash
otalan bundle --target capacitor --bundle-id 1.0.5
otalan bundle --target expo --bundle-id 1.0.5
```

`bundleId` is the customer-facing OTA release identifier for all targets. The CLI maps it to the target-specific metadata internally.

If you omit `bundleId`:

- the CLI reads `nativeVersion` from the selected native platform and adds a short hash suffix
- example: `1.0.0-abc123def456`

If you want to take the bundle ID from `package.json` instead:

```bash
otalan bundle --target capacitor --bundle-from-package
```

### `otalan publish`

Publishes the current bundle output.

`otalan publish` uses the `bundleId`, `platform`, and `nativeVersion` already stored in `.otalan/bundle/manifest.json`. To publish `1.0.5`, set it when you run `otalan bundle --bundle-id 1.0.5`.

Default flow:

```bash
otalan publish --channel production
```

Direct publish with existing storage:

```bash
otalan publish \
  --channel production \
  --storage-key otalan-bundles/example.zip
```

### `otalan bundles`

Lists remote bundles for the current app so you can choose a bundle for rollback or rollout operations.

```bash
otalan bundles --platform ios --channel production --native-version 1.0.0
```

### `otalan rollback`

Reactivates an older bundle for the same tuple.

```bash
otalan rollback --bundle-id 1.0.0-web.1 --platform ios --channel production --native-version 1.0.0
```

### `otalan status`

Shows the active bundle plus matching bundle history.

```bash
otalan status --platform ios --channel production --native-version 1.0.0
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
  "createdAt": "2026-04-07T12:00:00.000Z",
  "platform": "ios"
}
```

## Notes

- The CLI is Bun-first.
- Expo bundling uses `bunx expo ...`.
- Default API URL is `https://api.otalan.com`.
- Local development API URL is `http://localhost:8787`.
- Publishing, rollback, status, and `bundles` expect a CI key.
