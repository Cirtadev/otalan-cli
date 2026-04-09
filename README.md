# `@otalan/cli`

Otalan CLI for bundling and publishing OTA updates.

## What It Does

- logs into the Otalan API
- links the current repo to an Otalan app
- bundles Capacitor or Expo web output
- uploads a bundle archive to managed storage
- publishes a bundle
- lists published bundles
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

`otalan.config.json` only links the repo to an Otalan project/app. Bundle and release targeting data such as `target`, `platform`, `nativeVersion`, and `bundleId` live in `.otalan/bundle/manifest.json`.

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
- Expo runs `bunx expo export --platform <platform>`
- Expo stores the resolved Expo app config in `.otalan/bundle/manifest.json` so publish/upload can forward it for `extra.expoClient`
- both outputs produce a ZIP plus `manifest.json`
- `--platform` is required so the CLI exports the selected platform and resolves the correct native/runtime version

Native version defaults:

- Capacitor iOS reads `CFBundleShortVersionString` from `Info.plist` and resolves `$(MARKETING_VERSION)` from the Xcode project when needed
- Capacitor Android reads `versionName` from `android/app/build.gradle` or `build.gradle.kts`
- Expo reads the selected platform version from Expo config and falls back to the top-level Expo `version`
- Expo runtimeVersion reads `--runtime-version`, Expo export metadata, or Expo config runtimeVersion policies/strings
- `--native-version` overrides auto-detection

Choose the bundle ID you want to publish:

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

Publishes the current bundle output.

`otalan publish` uses the `bundleId`, `platform`, and `nativeVersion` already stored in `.otalan/bundle/manifest.json`. To publish `1.0.5`, set it when you run `otalan bundle --bundle-id 1.0.5`.

Current behavior:

- `channel` is chosen at publish time
- `--platform` and `--native-version` can override the manifest, but only if they match it
- `--output-dir` lets you publish a bundle from a non-default folder
- Expo publish/upload forwards the stored Expo app config when present

Default flow:

```bash
otalan publish --channel production
```

This uses `POST /v1/releases/create`, which uploads the ZIP and publishes it in one request.

### `otalan upload`

Uploads the current bundle archive without publishing it.

Use this when you want the refactored two-step managed storage flow:

1. `otalan upload` to get a managed `storageKey`
2. `otalan publish --storage-key ...` to activate it later

```bash
otalan upload --channel production
```

Direct publish with existing storage:

```bash
otalan publish \
  --channel production \
  --storage-key otalan-bundles/example.zip
```

Direct publish with BYO hosting:

```bash
otalan publish \
  --channel production \
  --download-url https://cdn.example.com/ios/1.0.5.zip
```

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

Shows the active bundle plus matching bundle history.

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

## Notes

- The CLI is Bun-first.
- Expo bundling uses `bunx expo ...`.
- Default API URL is `https://api.otalan.com`.
- Local development API URL is `http://localhost:8787`.
- Publishing, rollback, status, and `bundles` expect a CI key.
- Run `bun run build` after changing CLI source if you want `dist/bin.js` updated locally.
