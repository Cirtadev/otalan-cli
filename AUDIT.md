# Otalan CLI — Code Audit

**Scope:** `src/**/*.ts` at the current HEAD. Tests reviewed for coverage gaps but not graded for quality. Four lenses: security, correctness, code quality, performance.

**Verdict:** The codebase is in good shape overall — small, well-typed, well-tested (3,352 LOC of tests against 3,641 LOC of source), with sensible architecture (thin command handlers, isolated HTTP/bundle/config modules). No critical vulnerabilities found. The findings below are mostly papercuts, foot-guns, and one real UX/security bug around `otalan login`.

Severity legend: **H** = address before next release, **M** = address soon, **L** = nice to fix, **N** = note/observation.

---

## High-severity findings

### H-1 — `otalan login` echoes the OTA Publish Key as you type it
**Files:** `src/cli/prompts.ts:46-56`, `src/commands/auth.ts:62-70`

`prompt()` uses `readline.createInterface({ input, output }).question(...)`, which echoes every character to the TTY. The login flow uses this same `prompt` for the OTA Publish Key, so the secret is rendered to the terminal — visible to anyone shoulder-surfing and, more importantly, persisted in shell scrollback and terminal recording tools (tmux capture buffers, iTerm logs, screen-share recordings, etc.).

For comparison, `git credential` and `gh auth login` both suppress echo when reading tokens.

**Fix:** add a `secret?: boolean` flag to `promptWithHint`. When set, switch stdin to raw mode for the duration of the read and write `*` (or nothing) instead of the typed character. The existing raw-mode handling in `promptSelect` (lines 192–219) is most of the scaffolding you need.

---

### H-2 — `otalan login` saves the credential before validating it
**Files:** `src/commands/auth.ts:123-143`

```ts
await saveGlobalConfig({ apiKey, apiUrl })     // line 126 — writes ~/.otalan/config.json
const context = await getReleaseContext(...).catch(() => null)  // line 131 — validates
if (context) { ... }
console.log('Saved CLI auth.')                  // line 142 — always prints, even on invalid key
```

If the user pastes a malformed or revoked key, the CLI silently overwrites a previously-valid `~/.otalan/config.json`, prints "Saved CLI auth.", and the user only discovers the breakage on the next `otalan publish`. Worse, there is no way to "undo" the save — the prior key is gone.

**Fix:** call `getReleaseContext` *before* `saveGlobalConfig`. If it throws, surface the error and abort with a non-zero exit. Only `console.log('Saved CLI auth.')` after persistence succeeds *and* validation succeeds.

---

## Medium-severity findings

### M-1 — Network failure silently disables the "already published" guardrail
**File:** `src/commands/bundle.ts:294-372`

`resolveExistingPublishedBundleCheck` wraps the entire API call in a single `try { ... } catch { return { checked: false } }`. `assertNoExistingPublishedBundle` then only throws if `input.release` is set — so a transient 5xx, DNS failure, or revoked API key all result in the duplicate-bundle check being silently skipped and the bundle being written anyway.

This subverts the protection the check is supposed to provide. Worse: the user gets *no signal at all* that the check was skipped.

**Fix:** at minimum, log a `console.warn` when `checked: false`. Better, distinguish "auth/network failure" (warn + continue) from "no project config / no API key" (skip silently) so the warning is meaningful. Best, fail closed: if the user already configured an API key, treat a check failure as a hard error unless they pass `--skip-published-check`.

---

### M-2 — `requestJson` query-string builder silently drops falsy values
**File:** `src/http.ts:140-144`

```ts
for (const [key, value] of Object.entries(input.query ?? {})) {
  if (value) {            // <-- drops '0' and ''
    url.searchParams.set(key, value)
  }
}
```

Any legitimate query value of `'0'` or `''` is dropped. Not a problem for any *current* caller (all callers pass `appId`, `platform`, `channel`, `runtimeVersion`, `bundleId` — none of which are validly `'0'`/`''`), but it's a foot-gun for the next person who adds a `--limit 0` or similar.

**Fix:** `if (value !== undefined)`.

---

### M-3 — `parseArgs` treats `-`-prefixed values as boolean flags
**File:** `src/cli/args.ts:25-34`

```ts
const next = rest[index + 1]
if (!next || next.startsWith('-')) {
  options[key] = true
  continue
}
```

`--release-notes "-fix CVE issue"` would parse as `{ 'release-notes': true }` rather than capturing the string, because the value starts with `-`. Same for any user-supplied string beginning with a hyphen (negative version numbers, hyphenated git refs, etc.).

This is a known trade-off in hand-rolled argv parsers, but it's worth at least supporting the `--key=value` form so users have an unambiguous escape hatch.

**Fix:** handle `--key=value` explicitly (split on the first `=`). Optionally, support `--` as an end-of-options marker.

---

### M-4 — `assertResponseOk` swallows non-JSON error bodies
**File:** `src/http.ts:112-128`

```ts
const payload = await parseJson(response).catch(() => ({} as JsonObject))
const messageValue = payload.message
const message = typeof messageValue === 'string'
  ? messageValue
  : `Request failed with status ${response.status}`
```

When the API (or, more likely, a load balancer / CDN / gateway in front of it) returns an HTML or plain-text error body, the diagnostics collapse to just `Request failed with status 502`. The actual body — often the most useful debugging signal — is discarded.

By contrast, `assertDirectUploadResponseOk` (line 158-169) does the right thing: reads the body as text and includes it in the error.

**Fix:** mirror the direct-upload helper. Try `parseJson` first; if it fails *and* the body has text, append a truncated version of the text body to the error message.

---

### M-5 — Synchronous `zipSync` blocks the event loop for large bundles
**File:** `src/bundle.ts:156-177`

`zipSync(entries, { level: 9 })` is fully synchronous (fflate's sync API) at maximum compression. For a typical Capacitor/Expo bundle this is fine, but for a multi-hundred-megabyte web export it will block the event loop for seconds at a time. The level-9 max-compression also is the slowest setting; for an OTA bundle that's about to be re-compressed/hashed by the storage backend, level 6 is a sensible default.

Compounding this, `collectDirectoryEntries` (line 97-144) reads every file via `Bun.file(...).arrayBuffer()` *before* zipping, so peak memory ≈ Σ(file sizes) + zip output. A 500 MB export uses ~1 GB RAM.

**Fix:** switch to fflate's async `zip(...)` (uses workers) or `Zip` streaming API; consider lowering default compression to level 6 with a `--max-compression` opt-in; stream files into the zip rather than buffering all of them in a record.

---

### M-6 — `resolveApiKeysUrl()` is hard-coded to `https://otalan.com/api-keys`
**File:** `src/cli/helpers.ts:29-31`

```ts
export function resolveApiKeysUrl() {
  return 'https://otalan.com/api-keys'
}
```

This URL is shown to the user during `otalan login` regardless of the configured `apiUrl`. Self-hosted or staging users get pointed at the production marketing site to fetch a key that won't work against their `apiUrl`.

**Fix:** derive from `apiUrl` (e.g., the public host part with `/api-keys` appended), or accept it as a second config field with the production URL as default.

---

### M-7 — `~/.otalan/` directory is created with default permissions
**File:** `src/config.ts:48-61`

`writeJsonFile` does `await mkdir(path.dirname(filePath), { recursive: true })` with no `mode`. On a typical default umask (0o022) the `.otalan/` directory ends up `0o755` — world-readable. The *file* inside is correctly `0o600`, but on a multi-user system the directory listing reveals the file exists and an attacker who later gains brief read access (e.g., a misconfigured backup) sees nothing protecting the directory.

Defense in depth — the file mode is the real lock here — but worth tightening.

**Fix:** when persisting the global config, do `await mkdir(globalDir, { recursive: true, mode: 0o700 })`. The project config file in repo root is fine.

---

## Low-severity findings

### L-1 — `printBundlesTable` silently truncates long values at 32 chars
**File:** `src/cli/output.ts:230-270`

`formatCell` does `value.slice(0, width)` with `width` capped at 32. A bundle ID, runtime version, or rollout state longer than 32 chars is silently truncated — no ellipsis, no warning. Users could easily mis-identify a bundle from the truncated display.

**Fix:** append `…` when truncating, or expose a `--wide` flag that disables width capping. Also worth adding `--json` for scripting.

---

### L-2 — Top-level error handler drops stack traces and exit codes
**File:** `src/bin.ts:111-118`

```ts
;(async () => {
  try { await main() }
  catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
})()
```

Two issues: (1) stacks are never shown — even with `DEBUG=1` or similar. Debugging an obscure failure from a user bug report requires shipping a patched build. (2) `process.exitCode = 1` is a *hint*; if any handle (timer, open socket, raw-mode stdin) is still alive the process won't exit immediately. Bun is generally good at flushing, but the prompt code in `prompts.ts` sets raw mode and may not always clean up on error.

**Fix:** honour `OTALAN_DEBUG=1` (or an existing convention) to print the full stack. Call `process.exit(1)` after a short timeout, or explicitly clean up the readline interface in a `process.on('uncaughtException')` handler.

---

### L-3 — Plist/pbxproj/build.gradle parsed with hand-rolled regex
**Files:** `src/bundle.ts:446-583`

`extractIosPlistString`, `extractXcodeBuildSettingValue`, and the `versionName` matcher in `resolveAndroidRuntimeVersion` parse XML/Xcode/Gradle file formats with regex. They will misfire on multi-line attribute values, commented-out lines, and any non-trivial Gradle DSL.

This is an *acceptable* heuristic for a fallback path (the user can always pass `--runtime-version` to bypass it), but worth documenting in `README.md` so users don't waste time debugging false negatives.

**Fix:** add a single sentence in the README under runtime-version resolution noting the heuristics are best-effort.

---

### L-4 — `findRuntimeVersionInObject` deep-walks user-controlled JSON
**File:** `src/bundle.ts:354-387`

Recursive walk over `metadata.json` from an Expo export, picking the first `runtimeVersion` string it finds anywhere in the tree. Two concerns: (1) silent ambiguity — if Expo's metadata format ever ships multiple `runtimeVersion` keys (per-platform, per-asset), we pick a non-deterministic one based on iteration order; (2) the function has no depth limit and a pathological `metadata.json` could blow the stack. Both are unlikely but cheap to harden.

**Fix:** add a depth limit (`if (depth > 32) return undefined`) and prefer a specific known path (`metadata.runtimeVersion` or `metadata.platforms[platform].runtimeVersion`) before falling back to the deep walk.

---

### L-5 — `assertRequiredStorageUploadHeaders` doesn't validate the upload URL
**File:** `src/http.ts:171-179, 217-231`

The CLI happily PUTs the bundle to whatever URL the API hands back, with no scheme/host validation. This is the standard presigned-URL pattern, so it's intentional, but if the API is ever compromised the CLI becomes an outbound exfiltration channel for user bundles. Reasonable defence: require HTTPS.

**Fix:**
```ts
const parsed = new URL(input.uploadUrl)
if (parsed.protocol !== 'https:') {
  throw new Error('Refusing to upload bundle over non-HTTPS URL.')
}
```

---

### L-6 — Expo manifest sent on publish includes the entire `expoConfig`
**Files:** `src/bundle.ts:802-810`, `src/commands/release.ts:183-189`

`bundleExpoProject` reads the Expo config via `bunx expo config --json`, which can include `extra`, plugin configs, and any other custom fields the developer has added — possibly including environment-injected secrets that happen to land in `app.config.js`. `resolveManifestExpoPublishMetadata` stringifies the whole thing and ships it to the server as `expoManifest`.

The Otalan server presumably needs this for update manifests, but it's worth: (a) calling out in README that the Expo config is uploaded as-is, (b) optionally filtering known-sensitive keys before stringify.

---

### L-7 — `bundle.ts` `runCommand` spawns `bunx expo` with no version pin
**File:** `src/bundle.ts:248-260, 286-306`

`bunx expo` will resolve whichever `expo` binary is on PATH or in `node_modules`. If a project pins an old Expo SDK with a known-broken `expo export`, the CLI fails opaquely. Mostly a UX issue, but also a tiny supply-chain surface — `bunx` will happily download whatever's at npm `expo@latest` if nothing is installed locally.

**Fix:** check that `expo` exists in `node_modules` before invoking; if not, print a clear "install Expo CLI first" error instead of letting `bunx` reach out to npm.

---

## Notes / observations

### N-1 — Test coverage looks broad, with two gaps worth filling
The test suite (`tests/`) covers parsing, HTTP wire format, bundle building, manifest validation, and command handlers including integration tests for `auth`. Two specific gaps mapping to findings above:

- **No test covers H-2 (login save-before-validate).** A test that mocks `getReleaseContext` to reject and asserts `saveGlobalConfig` was *not* called would lock in the correct behaviour after fixing.
- **No test covers M-1 (silent skip on network failure during bundle).** A test that mocks `listReleases` to reject and asserts the user sees a warning (or the command aborts) would prevent regression.

### N-2 — Tight, consistent code style
ESLint config is strict, tsconfig has `strict: true`, and the codebase uses no `any`, no `as unknown as`, no `process.env` reads, no `require()`. Module boundaries are clean: `bundle.ts` ↔ `http.ts` don't import each other, command handlers depend on both, and `cli/` helpers stay UI-focused. This is well above average for a CLI project at this size.

### N-3 — `bundleTestUtils` / `releaseTestUtils` / `bundleCommandTestUtils` / `keygenCommandTestUtils` / `authCommandTestUtils` re-export internals for tests
This is a common pattern but worth noting that it expands the de-facto public surface. If you ever ship this as a library, those test-util exports will be importable by consumers. A `// @internal` JSDoc tag plus a build-time strip, or a separate `*.test-utils.ts` file excluded from `files` in `package.json`, would tighten the public surface. (`package.json` already restricts `files` to `dist/bin.js`, so this is moot for the published bin — but matters if you ever publish source.)

### N-4 — `dist/bin.js` is committed, but `dist/*` is gitignored except for it
This is an unusual choice (gitignored except for one tracked output) and only matters because `bun build` regenerates `dist/bin.js` on every `prepack`. Mostly fine; just noting it as a future surprise vector.

---

## Recommended priority order

1. **H-1** (login echoes secret) — quick win, real security/UX benefit.
2. **H-2** (login saves before validating) — quick win, prevents data loss.
3. **M-1** (silent skip of duplicate-bundle check) — semantic safety bug.
4. **M-4** (swallowed non-JSON error bodies) — debuggability win.
5. **M-2** (query-string drops '0'/'') — preventive, ~5 LOC fix.
6. **M-5** (sync zip + memory blowup) — only if users report large-bundle pain.
7. Rest of M-/L- items as time allows.
