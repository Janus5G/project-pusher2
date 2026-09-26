# Changelog

All notable changes to Project Pusher2 are documented in this file.

## [1.1.0] - 2026-09-26

### Added

- Automated GitHub Release generation for supported Electron projects using electron-builder.
- Scanner detection of safe release profiles before enabling release generation.
- Generation of `.github/workflows/release.yml` from the desktop application and RepoDoc flow.
- Cross-platform release builds for Windows x64 (`.exe`), Linux x64 (`.AppImage`), and macOS Universal (`.dmg` and `.zip`).
- Tag-to-`package.json` version verification before release builds continue.
- SHA-256 checksum generation through `SHA256SUMS.txt` and inclusion of checksums in GitHub Release notes.
- Automated publication of a GitHub Release only after every platform build succeeds.
- Release readiness information and an **Automated GitHub Release** option in the Project Pusher GUI.
- RepoDoc tests for release-profile detection and workflow generation.

### Safety

- Existing `.github/workflows/release.yml` files are never overwritten.
- Ambiguous build scripts and unsupported external electron-builder configuration are rejected instead of guessed.
- Missing expected release artifacts fail the workflow rather than publishing an incomplete release.

### Verification

- JavaScript test suite: 18/18 passed before release.
- Python RepoDoc test suite: 4/4 passed before release.
- GitHub Actions release pipeline verified end-to-end on the public Project Pusher2 repository.
- The verified v1.1.0 pipeline completed validation, Windows, Linux and macOS builds, SHA-256 generation, and GitHub Release publication successfully.

## [1.0.0] - 2026-09-25

- Initial Project Pusher2 public release.
