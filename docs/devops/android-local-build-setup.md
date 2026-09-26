# Android local build setup — Android SDK/JDK + AAB generation via VS Code

## What this covers

Local machine setup for building signed Android release artifacts
(`mobile-app/reactnative/`) — both the sideloadable `.apk` (`build-apk.sh`,
pre-existing) and the Play-Console-upload `.aab` (`build-aab.sh`, added
2026-09-26) — for both `staging` and `production`, runnable from a plain
terminal or from VS Code via `Tasks: Run Task`.

## Environment: JDK 17 + Android SDK

Both must be visible to **every** process that might build the app, not just
an interactive terminal: a VS Code task, an extension-spawned Gradle daemon,
and a plain `Terminal.app` window all resolve environment variables
differently.

- `~/.zshenv` (not `~/.zshrc`) is the source of truth: it loads for **every**
  zsh invocation — interactive, non-interactive, login, non-login — so it's
  the one file every one of the above actually reads. It sets `JAVA_HOME`,
  `ANDROID_HOME`, `ANDROID_SDK_ROOT`, and prepends
  `$JAVA_HOME/bin`, `$ANDROID_HOME/platform-tools`, `$ANDROID_HOME/emulator`,
  `$ANDROID_HOME/cmdline-tools/latest/bin` to `PATH`.
- `~/.zshrc` previously duplicated the `ANDROID_HOME`/`PATH` exports and
  pointed at two directories (`$ANDROID_HOME/tools`, `$ANDROID_HOME/tools/bin`)
  that don't exist in this SDK layout anymore (superseded by
  `cmdline-tools/`) — cleaned up to a comment pointing at `.zshenv`, so the
  two files can't silently diverge again.
- `launchctl setenv JAVA_HOME / ANDROID_HOME / ANDROID_SDK_ROOT` was also run,
  for apps launched from Finder/Dock rather than a terminal (VS Code itself,
  if not launched via a shell). **This does not survive a reboot or logout**
  — re-run it if `java`/`sdkmanager` ever go missing from a GUI-launched app's
  own environment after one:
  ```
  launchctl setenv JAVA_HOME "/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
  launchctl setenv ANDROID_HOME "$HOME/Library/Android/sdk"
  launchctl setenv ANDROID_SDK_ROOT "$HOME/Library/Android/sdk"
  ```
- `mobile-app/reactnative/.vscode/settings.json`'s `terminal.integrated.env.osx`
  is a third, redundant safety net scoped to just this workspace, so opening
  this folder in VS Code works even on a machine where the two steps above
  haven't been done.

The SDK itself (`~/Library/Android/sdk`) already had everything needed
(build-tools 35–37, platforms 36/36.1, cmdline-tools, emulator, NDK) — this
was purely an env-wiring gap, not a missing-package one. `android-sdk-license`
is already accepted (`~/Library/Android/sdk/licenses/`).

## `bundletool` — deliberately not installed

`brew install bundletool` pulls in `openjdk` (a **second**, newer JDK, not the
17 already set up above) as a dependency, and on this Intel Mac (a Homebrew
Tier 3 / unsupported configuration — Homebrew no longer ships prebuilt
bottles for it) that `openjdk` formula requires a **full Xcode.app install**
(not just Command Line Tools) to compile from source. Not worth a 10+ GB
Xcode install for a tool that's only useful for locally generating installable
APK splits from an `.aab` — `build-apk.sh` already covers real-device testing,
and Play Console's own internal-testing track is the normal way to test an
`.aab` end to end. Skipped; revisit only if a real need for local AAB
splitting comes up.

## `build-aab.sh`

Mirrors `build-apk.sh`'s structure and checks (JAVA_HOME, `NODE_ENV`-selected
`.env.*` file, mock-flag gate, signing credentials from
`~/.android-keystores/paymax-release.properties`) but runs
`./gradlew bundleRelease` and verifies the `.aab` instead of the `.apk`. The
two real differences from the APK script, both found by actually running it
rather than assuming APK logic ports over unchanged:

1. **Paths inside the archive.** An AAB's JS bundle and native libs live
   under a module prefix (`base/assets/...`, `base/lib/<abi>/...`), not at
   the zip root like an APK — the script finds the JS bundle entry by name
   (`unzip -Z1 ... '*assets/index.android.bundle'`) rather than assuming the
   exact path.
2. **Signature verification tool.** An `.aab` is JAR-signed (`jarsigner`), not
   APK-Signature-Scheme-signed (`apksigner` — that only applies to the actual
   installable APK(s) Play/`bundletool` generate from the bundle later).
   `jarsigner -verify` (no `-verbose`/`-certs`) is the reliable pass/fail
   signal — exit 0 means every entry checks out. A **separate** call with
   `-verbose -certs` is only used to extract which certificate signed it, for
   the log; its own exit code is not used for pass/fail, because it can print
   benign "signed in JarFile but is not signed in JarInputStream" notices for
   modern AAB metadata entries (jarsigner's older streaming verifier doesn't
   fully understand them) and an expected "Invalid certificate chain" note
   (self-signed release keys have no CA trust chain — Android doesn't need
   one, it only compares the certificate fingerprint across app updates).
   Both looked like real failures on the first pass at this script and were
   not; verified against a real, correctly-signed `.aab` before trusting the
   fix.

Verified end to end for both `NODE_ENV=staging` and `NODE_ENV=production`:
`BUILD SUCCESSFUL`, correct API host baked in, no loopback URLs, correct ABI,
`Signed with: X.509, CN=Paymax Release Key, OU=Mobile, O=Paymax`.

## VS Code tasks

`mobile-app/reactnative/.vscode/tasks.json` — open that folder in VS Code,
then **Terminal → Run Task…** (or Cmd+Shift+P → `Tasks: Run Task`):

- `Android: Prebuild (clean)`
- `Android: Build AAB (staging)` / `Android: Build AAB (production)`
- `Android: Build APK (staging)` / `Android: Build APK (production)`

## Fixed along the way

- **`.env.staging` was missing `EXPO_PUBLIC_STAYS_HOTELIER_USE_MOCK`** (present
  in `.env.production` and its own `.example`, absent from `.env.staging` and
  `.env.staging.example`) — `check-env-mocks.mjs` correctly refused to build
  until this was added (`false`, matching production).
- **`react-native`/`expo` version mismatch, again.** This checkout still had
  the same bad Dependabot bump (`react-native` 0.81.5 → 0.87.1, mislabeled
  "npm-minor-patch"; see the PR #230 commit message for the full story) that
  was fixed in the shared worktree but never landed here. It surfaced as a
  genuine `bundleRelease` **build failure** this time (a Kotlin compiler
  metadata-version mismatch: `kotlin-stdlib` resolved to 2.2.0 against a
  2.0.0 compiler, pulled in transitively by the wrong `expo`/`expo-updates`
  version), not just `tsc` noise — confirming this is a real, not merely
  cosmetic, incompatibility. Re-ran `npx expo install --fix` here directly.
- **A stale Gradle daemon lock.** `buildLogic.lock` owned by a PID that no
  longer existed (an earlier daemon that died uncleanly) blocked a build with
  "Timeout waiting to lock build logic queue." `./gradlew --stop` clears the
  live daemon; the lock file itself is Gradle-managed and doesn't need manual
  deletion.
- **Watchman watching the entire monorepo root** (`spotlight/new`, every
  worktree, every `node_modules`), not just `mobile-app/reactnative` — every
  `expo prebuild`/bundler invocation's `watch-project` call paid the cost of a
  crawl over that whole tree (seen taking 200–450s, twice, in a single build).
  Added a root-level `.watchmanconfig` with `ignore_dirs` for `node_modules`,
  `.git`, `android`, `ios/Pods`, `.expo`, `.gradle`, `build`, `dist`, `.next`
  — applied non-disruptively (no `watchman watch-del` on the live root, which
  another worktree's running `expo start` dev server depends on for Fast
  Refresh; takes effect on the next natural recrawl instead).
