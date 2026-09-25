# Project Pusher2

[![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/docs/Web/JavaScript)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](./package.json)
[![CI](https://github.com/Janus5G/Project-Pusher2/actions/workflows/ci.yml/badge.svg)](https://github.com/Janus5G/Project-Pusher2/actions/workflows/ci.yml)
[![Security Scan](https://github.com/Janus5G/Project-Pusher2/actions/workflows/security-scan.yml/badge.svg)](https://github.com/Janus5G/Project-Pusher2/actions/workflows/security-scan.yml)

> Desktop app that stages, commits and pushes local project folders to GitHub — without you touching the command line.

## What it does

Project Pusher is an Electron desktop app for developers who move between machines and side projects. Pick a folder, pick a repository, write a commit message, hit **Push**.

- 📁 **Folder → repo mapping** — remember which local folder belongs to which remote
- 🌿 **Branch & remote selection** — push to `main`, `develop`, or any branch
- ✍️ **Commit composer** — stage all or selected changes and write a conventional commit message
- 🔐 **Token vault** — the token stays in `.env` / OS keychain, never in the repository
- 🧾 **Push history** — see what was pushed, when, and to which branch
- 🖥️ **Cross-platform** — Windows, macOS and Linux builds

## Installation

### Prebuilt binaries

Download the latest installer from the [Releases](https://github.com/Janus5G/Project-Pusher/releases) page and verify the SHA-256 checksum listed in the release notes.

### From source

```bash
git clone https://github.com/Janus5G/Project-Pusher.git
cd Project-Pusher
npm install
cp .env.example .env   # then add your GitHub token
npm start
```

Requirements: **Node.js 22**, **npm 10+**, **Git 2.30+**.

## Usage

1. **Add a token.** Create a fine-grained GitHub PAT with `Contents: Read and write` and put it in `.env`:

   ```
   GITHUB_TOKEN=ghp_your_token_here
   ```

2. **Add a project.** Click **Add project**, choose a local folder and the target repository (`owner/name`).
3. **Pick a branch.** Default is `main`; any branch on the remote works.
4. **Stage & commit.** Review changed files, stage what you want, write a message.
5. **Push.** Project Pusher commits and pushes over HTTPS using your token.

Non-interactive example (CLI bridge):

```bash
npx project-pusher push --folder ./my-app --repo Janus5G/my-app --branch main -m "feat: initial push"
```

## Security

Project Pusher handles a credential that can write to your repositories, so it is built defensively:

- Tokens are **never** written to logs, crash reports, or the repository.
- `.env`, `*.pem`, `*.key`, `.ssh/` and `id_rsa*` are git-ignored by default.
- Every push and PR is scanned by **gitleaks**; `npm audit` runs in CI and weekly.
- The app talks only to `api.github.com` over HTTPS — no telemetry, no third-party analytics.

Found a vulnerability? Please report it privately — see [SECURITY.md](./SECURITY.md). **Do not** open a public issue.

## Development

```bash
npm install        # install dependencies
npm start          # run the Electron app in dev mode
npm run lint       # eslint
npm test           # unit + integration tests
npm run build      # produce distributables
```

Project layout:

```
main/         Electron main process (git + GitHub logic)
renderer/     UI (HTML/CSS/JS)
scripts/      build & docs automation
.github/      CI, security scanning, issue templates
```

Code style is enforced by `.editorconfig` + ESLint: UTF-8, LF, 2-space indent. See [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a PR.

## Release

1. Bump `version` in `package.json` (`npm version patch|minor|major`).
2. Update `CHANGELOG.md`.
3. Push the tag — CI builds Windows/macOS/Linux artifacts.
4. Create the GitHub release, attach artifacts and their SHA-256 checksums.
5. Verify the tag matches `package.json` before announcing.

## License

[MIT](./LICENSE) © Janus5G

## Support

- 🐛 [Bug reports](https://github.com/Janus5G/Project-Pusher/issues/new?template=bug_report.md)
- 💡 [Feature requests](https://github.com/Janus5G/Project-Pusher/issues/new?template=feature_request.md)
- 🔐 Security: security@project-pusher.dev
