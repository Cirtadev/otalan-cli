# Changelog

All notable changes to `@otalan/cli` will be documented in this file.

## 1.5.2 - 2026-05-28

### Changed

- Keep `otalan bundle` output compact by default with publish-style `Bundling` progress and `✅ Bundle created`; detailed bundle context, source-map counts, and JSON output now require `--verbose` or `-v`.
- Add `-v` as a short alias for verbose publish and bundle output.
- Print `Bundle selected:` before the rollback bundle summary and `✅ Rollback done` after it.
- Exit `otalan rollback` without prompting when no bundles are available for the selected tuple.

## 1.5.1 - 2026-05-26

### Changed

- Make `otalan publish` show compact animated progress by default, with green success and red failure states in interactive terminals.
- Add spacing around compact publish progress and highlight `Live` in green in interactive terminals.
- Keep CI-friendly static publish progress output in non-TTY environments.
- Move the previous detailed publish output behind `otalan publish --verbose`.
- Print `✅ Bundle generated` after `otalan bundle` writes the bundle output.

## 1.5.0 - 2026-05-23

### Added

- Add `otalan channels` to print the resolved organization/project context and list project release channels with their apps from `GET /v1/releases/channels`; it supports `--app-id`, and interactive runs default to `All` before optionally filtering by app.

### Changed

- Document Expo SDK 56 as officially supported.

### Fixed

- Avoid Bun worker ZIP compression failures when packaging large Expo export assets.

## 1.4.1 - 2026-05-22

### Changed

- Hide interactive OTA Publish Key input during `otalan login` and validate credentials before saving them.
- Surface skipped duplicate-bundle checks, non-JSON API error bodies, and truncated bundle table cells more clearly.
- Harden direct uploads, argument parsing, global config permissions, Expo CLI resolution, and Expo runtime metadata scanning.

## 1.4.0 - 2026-05-22

### Changed

- Send direct object-storage uploads with the API-provided `uploadHeaders`, including explicit `Content-Length`.

## 1.3.4 - 2026-05-21

### Changed

- Rename user-facing key wording to OTA Publish Key and OTA App Key, while documenting the existing `otalan_ci_` and `otalan_ota_` internal prefixes.

## 1.3.3 - 2026-05-18

### Changed

- Write bundle archives as `bundle-<bundle-id>.zip` while keeping `otalan publish` compatible with legacy `bundle.zip` output.

## 1.3.2 - 2026-05-18

### Added

- Print the linked project and app before `otalan bundle` packages output.
- Store the selected app name in `otalan.config.json` during `otalan init`.

### Changed

- Include the linked app in release command context output.

## 1.3.1 - 2026-05-18

### Added

- Check for an already published bundle ID during `otalan bundle` when auth and project config are available.

## 1.3.0 - 2026-05-18

### Added

- Validate Capacitor and Expo bundle contents before writing output, rejecting native project/source files in OTA bundle data.

### Changed

- Use `runtimeVersion` as the only bundle manifest, CLI option, and release API field for both Capacitor and Expo.

## 1.2.2 - 2026-05-13

### Changed

- Let `otalan login --api-key ...` use the saved or default API URL without prompting when `--api-url` is omitted.
- Remove verbose Capacitor and Expo implementation notes from the default help footer.

## 1.2.1 - 2026-05-11

### Changed

- Exclude source map files (`*.map`) from Capacitor and Expo bundle ZIPs by default and print the omitted file count.
- Clarify direct-upload wording around opaque `uploadUrl` values.
- Cancel the reserved ingest when the direct object-storage upload fails before completion.
- Add `otalan pause` and `otalan resume` commands for active bundle rollout control.

## 1.2.0 - 2026-05-08

### Changed

- Switch `otalan publish` to the direct-upload release contract: create JSON upload metadata, upload the ZIP to the returned opaque `uploadUrl`, complete the ingest, then poll validation.
- Stream the local ZIP through Bun's disk-backed file body during direct uploads instead of loading the full archive into memory.
- Send the full generated Otalan Expo satellite manifest as `expoManifest` during publish instead of only raw Expo config.
- Use the Expo `runtimeVersion` as the release version sent to the API, matching the current Expo update matching contract.
- Use the release bundle `publishedAt` timestamp for bundle lists, status summaries, rollback prompts, and published bundle ID hints.

## 1.1.1 - 2026-05-07

### Changed

- Remove unsupported target mentions from public documentation, CLI help, and package metadata.
- Document official support for Capacitor 7 and 8, and Expo SDK 54 and 55.

## 1.1.0 - 2026-05-07

### Added

- List active project apps during `otalan init` and validate `--app-id` against the logged-in project.

### Changed

- Let `otalan login` reuse the saved API URL and keep the saved OTA Publish Key from a masked prompt.
- Export Expo bundles into a project-local `.otalan/expo-export-*` folder so Expo accepts the output path.
- Fall back to the resolved app version when Expo runtimeVersion is not configured or present in export metadata.
- Clarify Capacitor and Expo bundling behavior in CLI help and README.

## 1.0.9 - 2026-05-06

### Added

- Add `otalan keygen --kind ci|ota` for offline Otalan key generation.

### Changed

- Keep help output concise by limiting notes to the most important release workflow reminders.

## 1.0.8 - 2026-05-06

### Changed

- Print the resolved organization and project before release commands continue.

## 1.0.7 - 2026-05-06

### Changed

- Clean public README examples to avoid project-specific app IDs, generated-looking slugs, and local development API URLs.
- Keep user-facing login guidance pointed at the public Otalan keys page.

## 1.0.6 - 2026-05-05

### Changed

- Improve README CI setup examples, generated output guidance, publish rollout examples, and maintainer release checklist.
- Add release metadata test coverage to keep package version and changelog entries in sync.

## 1.0.5 - 2026-05-04

### Changed

- Update npm package homepage metadata.

## 1.0.4 - 2026-05-04

### Added

- Prompt interactively for bundle runtime version and bundle ID, with hints for the detected runtime version, local bundle ID, and active published bundle ID when available.

### Changed

- Link npm package metadata and README introduction to https://otalan.com.

## 1.0.3 - 2026-05-04

### Added

- Add bundle prompt refinements for local and published bundle ID hints.

## 1.0.2 - 2026-05-04

### Added

- Add `otalan version`, `otalan --version`, and `otalan -v`.
- Show the installed CLI version in help output.

## 1.0.1 - 2026-05-04

### Changed

- Include `CHANGELOG.md` in the published package.

## 1.0.0 - 2026-05-04

Initial public release of the Otalan CLI.

### Added

- Capacitor OTA bundle packaging from built web assets.
- Expo OTA bundle packaging through `expo export`.
- Release publishing with rollout metadata and server-side validation polling.
- Bundle listing, active bundle status, and rollback commands.
- OTA Publish Key login, project initialization, and API connectivity doctor checks.
- Runtime version resolution helpers.
- Public npm package metadata, license notices, and Bun-based CLI entrypoint.
