# Changelog

All notable changes to `@otalan/cli` will be documented in this file.

## 1.0.4 - 2026-05-04

### Added

- Prompt interactively for bundle native version and bundle ID, with hints for the detected native version, local bundle ID, and active published bundle ID when available.

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
- Expo / React Native OTA bundle packaging through `expo export`.
- Release publishing with rollout metadata and server-side validation polling.
- Bundle listing, active bundle status, and rollback commands.
- CI key login, project initialization, and API connectivity doctor checks.
- Native version and Expo runtime version resolution helpers.
- Public npm package metadata, license notices, and Bun-based CLI entrypoint.
