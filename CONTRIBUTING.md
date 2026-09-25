# Contributing to Project Pusher

Thanks for taking the time to contribute! 🎉

This document describes how to report issues, propose features, and submit pull requests to Project Pusher.

## Table of contents

- [Code of Conduct](#code-of-conduct)
- [Reporting bugs](#reporting-bugs)
- [Suggesting features](#suggesting-features)
- [Development setup](#development-setup)
- [Pull request process](#pull-request-process)
- [Commit messages](#commit-messages)
- [Code style](#code-style)
- [Testing](#testing)
- [Security](#security)
- [Documentation](#documentation)

## Code of Conduct

This project is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md). By participating you agree to uphold it. Report unacceptable behaviour to the maintainers listed in [SECURITY.md](./SECURITY.md).

## Reporting bugs

1. Search existing issues first — yours may already be reported.
2. Open a new issue using the **Bug report** template.
3. Include OS, Project Pusher version, Node.js version and exact steps to reproduce.
4. Attach logs, but **never** paste tokens or `.env` contents.

## Suggesting features

1. Open an issue using the **Feature request** template.
2. Describe the problem, not only the solution.
3. Explain the workflow it improves.

## Development setup

```bash
git clone https://github.com/Janus5G/Project-Pusher.git
cd Project-Pusher
npm install
cp .env.example .env
npm start
```

Requirements:

- Node.js 20 or 22
- npm 10+
- Git 2.30+

## Pull request process

1. Fork the repository and create a topic branch: `git checkout -b feat/short-description`
2. Keep changes focused — one logical change per PR.
3. Run `npm run lint` and `npm test` before pushing.
4. Update `README.md` or docs when behaviour changes.
5. Open the PR against `main` and fill in the template.
6. A maintainer will review; at least one approval is required.
7. Squash-merge is the default strategy.

## Commit messages

Project Pusher follows [Conventional Commits](https://www.conventionalcommits.org/).

```
<type>(<scope>): <subject>
```

Common types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`.

Examples:

- `feat(pusher): add dry-run mode for pushes`
- `fix(auth): handle expired GitHub token`
- `docs(readme): document the release process`

## Code style

- 2-space indentation, LF line endings, UTF-8 (see `.editorconfig`).
- Semicolons and single quotes in JavaScript.
- Prefer `const`, then `let`. No `var`.
- Keep functions small and side effects explicit.
- Run `npm run lint` before committing.

## Testing

- Add or update tests for every behaviour change.
- `npm test` must pass locally and in CI.
- Cover error paths, not only the happy path.

## Security

- Never commit secrets. `.env` is git-ignored; use `.env.example` for templates.
- Report vulnerabilities privately — see [SECURITY.md](./SECURITY.md).
- Do not open public issues for security problems.

## Documentation

- Update `README.md` when user-facing behaviour changes.
- Document new environment variables in `.env.example`.
- Keep examples copy-pasteable.

Thanks again for contributing!
