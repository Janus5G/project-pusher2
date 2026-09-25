# Security Policy

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems.

Report privately using either:

1. GitHub's private vulnerability reporting — the **Security** tab → **Report a vulnerability**.
2. Email **security@project-pusher.dev** with the subject `[SECURITY] Project Pusher`.

Include:

- A description of the issue and its impact
- Steps to reproduce (proof of concept if possible)
- Affected version(s) and platform
- Any suggested fix or mitigation

### What to expect

| Stage            | Target                                   |
| ---------------- | ---------------------------------------- |
| Acknowledgement  | within 3 business days                   |
| Initial assess.  | within 7 business days                   |
| Fix / mitigation | depends on severity, usually within 30 d |
| Public disclosure| coordinated with you after a fix ships    |

We credit reporters in the release notes unless you ask us not to.

## Token handling best practices

Project Pusher pushes to Git repositories, so token hygiene matters.

**Do**

- Use a **fine-grained** GitHub PAT limited to the repositories you actually push to.
- Grant the minimum scope: `Contents: Read and write` (classic: `repo`).
- Set an expiry date and rotate tokens regularly.
- Store tokens in `.env` (git-ignored) or in your OS keychain — never in code.
- Use GitHub Actions secrets for CI, not repository variables.
- Revoke a token immediately if you suspect it leaked.

**Don't**

- Never commit `.env`, `*.pem`, `*.key` or `id_rsa*` — `.gitignore` blocks these, but stay vigilant.
- Never paste tokens into issues, PRs, screenshots or logs.
- Never share a token between machines or people.
- Never embed a token in a URL you might paste somewhere.

If a token is committed by accident:

1. Revoke it in GitHub → Settings → Developer settings → Personal access tokens.
2. Remove it from history (`git filter-repo` or BFG) and force-push.
3. Run `gitleaks detect` locally to confirm the repo is clean.

## GitHub configuration

Maintainers should keep the following enabled:

- **Branch protection** on `main`:
  - Require pull request reviews (1 approval)
  - Require status checks: `CI`, `Secret scan`
  - Require linear history, disallow force pushes
- **Secret scanning** + **push protection**
- **Dependabot alerts** and security updates
- **Private vulnerability reporting**
- **Actions permissions**: read-only `GITHUB_TOKEN` by default; grant `contents: write` only to the `RepoDoc` workflow

## What Project Pusher does and doesn't do

**Does**

- Read local repository files you point it at
- Talk to the GitHub API over HTTPS using the token you provide
- Create commits and push to the remote/branch you configure

**Doesn't**

- Send your code, tokens or telemetry to any third-party server
- Store your token anywhere except locally (`.env` / OS keychain)
- Modify repositories you haven't explicitly configured
- Bypass GitHub permissions — it can only do what your token allows

## Release verification

Releases are published from this repository only.

- Check the release tag matches the `version` field in `package.json`.
- Verify the commit SHA is signed and belongs to `main`.
- Installers built by CI include a SHA-256 checksum in the release notes.

```bash
sha256sum project-pusher-<version>-setup.exe
```

Compare it against the published checksum before running the installer.

## Contact

- Security: security@project-pusher.dev
- Maintainer: [@Janus5G](https://github.com/Janus5G)
