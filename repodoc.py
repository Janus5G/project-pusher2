#!/usr/bin/env python3
"""Local repository scanner and safe repo-file generator for Project Pusher.

The scanner is dependency-free, makes no external API calls, follows no symlinks,
and ignores dependency/build directories. By default it prints a JSON summary to
stdout. Use --generate to create missing GitHub-ready repository files; existing
files are never overwritten.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Iterable

IGNORE_DIRS = {
    ".git", "node_modules", ".venv", "venv", "env", "__pycache__", "dist", "build",
    "coverage", "target", "bin", "obj", ".next", ".nuxt", ".output", ".pytest_cache",
    ".mypy_cache", ".ruff_cache", ".tox", ".nox", ".gradle", ".idea", ".vscode",
    ".cache", ".turbo", ".parcel-cache", "vendor", "out", "release", "releases",
    "tmp", "temp",
}

LANGUAGE_BY_EXTENSION = {
    ".js": "JavaScript", ".cjs": "JavaScript", ".mjs": "JavaScript", ".jsx": "JavaScript",
    ".ts": "TypeScript", ".tsx": "TypeScript", ".py": "Python", ".pyi": "Python",
    ".go": "Go", ".rs": "Rust", ".java": "Java", ".kt": "Kotlin", ".kts": "Kotlin",
    ".cs": "C#", ".fs": "F#", ".vb": "Visual Basic .NET", ".cpp": "C++",
    ".cc": "C++", ".cxx": "C++", ".c": "C", ".h": "C/C++", ".hpp": "C++",
    ".rb": "Ruby", ".php": "PHP", ".swift": "Swift", ".scala": "Scala",
    ".dart": "Dart", ".vue": "Vue", ".svelte": "Svelte", ".html": "HTML",
    ".css": "CSS", ".scss": "SCSS", ".sh": "Shell", ".ps1": "PowerShell", ".sql": "SQL",
}

STANDARD_REPO_FILES = [
    ".gitignore", "README.md", "SECURITY.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md",
    ".editorconfig", ".github/workflows/ci.yml", ".github/workflows/repodoc.yml",
    ".github/dependabot.yml", ".github/ISSUE_TEMPLATE/bug_report.md",
    ".github/ISSUE_TEMPLATE/feature_request.md", ".gitleaks.toml", ".env.example",
]

SAFE_ENV_FILES = {".env.example", ".env.sample", ".env.template"}
TEXT_EXTENSIONS = {
    ".txt", ".md", ".json", ".jsonc", ".js", ".cjs", ".mjs", ".jsx", ".ts", ".tsx",
    ".py", ".toml", ".yaml", ".yml", ".ini", ".cfg", ".conf", ".xml", ".properties",
    ".env", ".sh", ".bash", ".zsh", ".ps1", ".cs", ".java", ".go", ".rs", ".rb", ".php",
}

CONTENT_SECRET_PATTERNS = [
    ("Private key material", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
    ("GitHub token-like value", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b")),
    ("AWS access key-like value", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("OpenAI token-like value", re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b")),
]


def posix(path_value: str | Path) -> str:
    return str(path_value).replace(os.sep, "/")


def read_text(path: Path, max_bytes: int = 1024 * 1024) -> str:
    try:
        if path.stat().st_size > max_bytes:
            return ""
        return path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""


def read_json(path: Path) -> dict:
    text = read_text(path)
    if not text:
        return {}
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def walk_project(root: Path, max_files: int = 15000) -> tuple[list[dict], list[str], bool]:
    files: list[dict] = []
    ignored: set[str] = set()
    truncated = False
    stack = [root]

    while stack:
        directory = stack.pop()
        try:
            entries = sorted(os.scandir(directory), key=lambda e: e.name.lower())
        except OSError:
            continue
        for entry in entries:
            try:
                if entry.is_symlink():
                    continue
                relative = posix(Path(entry.path).relative_to(root))
                if entry.is_dir(follow_symlinks=False):
                    if entry.name in IGNORE_DIRS:
                        ignored.add(relative)
                    else:
                        stack.append(Path(entry.path))
                    continue
                if entry.is_file(follow_symlinks=False):
                    files.append({"path": relative, "size": entry.stat(follow_symlinks=False).st_size})
                    if len(files) >= max_files:
                        truncated = True
                        stack.clear()
                        break
            except OSError:
                continue

    files.sort(key=lambda item: item["path"])
    return files, sorted(ignored), truncated


def project_type_label(kind: str) -> str:
    return {
        "node": "Node", "python": "Python", "go": "Go", "rust": "Rust",
        "java": "Java", "dotnet": ".NET", "generic": "Generic",
    }.get(kind, "Generic")


def parse_metadata(root: Path, files: list[dict]) -> dict:
    file_set = {item["path"] for item in files}
    package = read_json(root / "package.json") if "package.json" in file_set else {}
    pyproject = read_text(root / "pyproject.toml") if "pyproject.toml" in file_set else ""
    requirements = read_text(root / "requirements.txt") if "requirements.txt" in file_set else ""
    cargo = read_text(root / "Cargo.toml") if "Cargo.toml" in file_set else ""
    go_mod = read_text(root / "go.mod") if "go.mod" in file_set else ""
    pom = read_text(root / "pom.xml") if "pom.xml" in file_set else ""
    gradle_name = "build.gradle.kts" if "build.gradle.kts" in file_set else ("build.gradle" if "build.gradle" in file_set else "")
    gradle = read_text(root / gradle_name) if gradle_name else ""
    csproj_path = next((item["path"] for item in files if "/" not in item["path"] and item["path"].lower().endswith(".csproj")), "")
    csproj = read_text(root / csproj_path) if csproj_path else ""

    if "package.json" in file_set:
        kind = "node"
    elif pyproject or requirements or "setup.py" in file_set or "Pipfile" in file_set:
        kind = "python"
    elif go_mod:
        kind = "go"
    elif cargo:
        kind = "rust"
    elif pom or gradle:
        kind = "java"
    elif csproj_path or "global.json" in file_set or any(p.endswith(".sln") for p in file_set):
        kind = "dotnet"
    else:
        kind = "generic"

    name = str(package.get("name") or root.name)
    description = str(package.get("description") or "")

    if kind == "python" and pyproject:
        match = re.search(r"\[project\]([\s\S]*?)(?=\n\[|\Z)", pyproject) or re.search(r"\[tool\.poetry\]([\s\S]*?)(?=\n\[|\Z)", pyproject)
        block = match.group(1) if match else ""
        name_match = re.search(r'^\s*name\s*=\s*["\']([^"\']+)["\']', block, re.M)
        desc_match = re.search(r'^\s*description\s*=\s*["\']([^"\']+)["\']', block, re.M)
        if name_match:
            name = name_match.group(1)
        if desc_match:
            description = desc_match.group(1)
    elif kind == "rust" and cargo:
        match = re.search(r"\[package\]([\s\S]*?)(?=\n\[|\Z)", cargo)
        block = match.group(1) if match else ""
        name_match = re.search(r'^\s*name\s*=\s*["\']([^"\']+)["\']', block, re.M)
        desc_match = re.search(r'^\s*description\s*=\s*["\']([^"\']+)["\']', block, re.M)
        if name_match:
            name = name_match.group(1)
        if desc_match:
            description = desc_match.group(1)
    elif kind == "go" and go_mod:
        module = re.search(r"^\s*module\s+(\S+)", go_mod, re.M)
        if module:
            name = module.group(1).split("/")[-1]

    deps = set()
    for key in ("dependencies", "devDependencies", "peerDependencies"):
        value = package.get(key, {})
        if isinstance(value, dict):
            deps.update(str(item).lower() for item in value)

    return {
        "kind": kind, "name": name, "description": description, "package": package,
        "deps": deps, "pyproject": pyproject, "requirements": requirements,
        "cargo": cargo, "go_mod": go_mod, "pom": pom, "gradle": gradle,
        "csproj": csproj,
    }


def detect_frameworks(meta: dict) -> list[str]:
    frameworks = set()
    dep_hints = {
        "electron": "Electron", "react": "React", "vite": "Vite", "next": "Next.js",
        "express": "Express", "@nestjs/core": "NestJS", "vue": "Vue", "svelte": "Svelte",
        "jest": "Jest", "vitest": "Vitest", "@playwright/test": "Playwright",
        "playwright": "Playwright", "cypress": "Cypress", "mocha": "Mocha",
        "fastify": "Fastify", "typescript": "TypeScript",
    }
    for dep, label in dep_hints.items():
        if dep in meta["deps"]:
            frameworks.add(label)

    py_lower = f'{meta["pyproject"]}\n{meta["requirements"]}'.lower()
    for needle, label in (("fastapi", "FastAPI"), ("flask", "Flask"), ("django", "Django"),
                          ("pytest", "pytest"), ("uvicorn", "Uvicorn"), ("pydantic", "Pydantic"),
                          ("sqlalchemy", "SQLAlchemy"), ("poetry", "Poetry"), ("playwright", "Playwright")):
        if needle in py_lower:
            frameworks.add(label)

    for text, hints in (
        (meta["cargo"].lower(), (("tokio", "Tokio"), ("axum", "Axum"), ("actix-web", "Actix Web"), ("rocket", "Rocket"), ("clap", "Clap"))),
        (meta["go_mod"].lower(), (("gin-gonic/gin", "Gin"), ("labstack/echo", "Echo"), ("gofiber/fiber", "Fiber"), ("spf13/cobra", "Cobra"))),
        (f'{meta["pom"]}\n{meta["gradle"]}'.lower(), (("spring-boot", "Spring Boot"), ("junit", "JUnit"), ("quarkus", "Quarkus"))),
        (meta["csproj"].lower(), (("microsoft.aspnetcore", "ASP.NET Core"), ("xunit", "xUnit"), ("nunit", "NUnit"), ("mstest", "MSTest"))),
    ):
        for needle, label in hints:
            if needle in text:
                frameworks.add(label)
    return sorted(frameworks)


def detect_package_managers(meta: dict, file_set: set[str]) -> list[str]:
    managers = []
    if "pnpm-lock.yaml" in file_set:
        managers.append("pnpm")
    elif "yarn.lock" in file_set:
        managers.append("yarn")
    elif "package-lock.json" in file_set or meta["package"]:
        managers.append("npm")
    if "poetry.lock" in file_set or "[tool.poetry]" in meta["pyproject"]:
        managers.append("poetry")
    elif "Pipfile" in file_set:
        managers.append("pipenv")
    elif meta["pyproject"] or meta["requirements"]:
        managers.append("pip")
    if meta["cargo"]:
        managers.append("cargo")
    if meta["go_mod"]:
        managers.append("go modules")
    if meta["pom"]:
        managers.append("maven")
    if meta["gradle"]:
        managers.append("gradle")
    if meta["csproj"] or any(name.endswith(".sln") for name in file_set):
        managers.append("dotnet")
    return sorted(set(managers))


def detect_tests(meta: dict, frameworks: list[str], managers: list[str], files: list[dict], root: Path) -> tuple[list[str], list[str]]:
    tests = set()
    commands = []
    file_paths = [item["path"] for item in files]

    script = meta["package"].get("scripts", {}).get("test") if isinstance(meta["package"].get("scripts"), dict) else None
    if isinstance(script, str) and "no test specified" not in script.lower() and "exit 1" not in script.lower():
        tests.add("npm test")
        manager = next((item for item in managers if item in {"npm", "yarn", "pnpm"}), "npm")
        commands.append("npm test" if manager == "npm" else f"{manager} test")
    for label in ("Jest", "Vitest", "Playwright", "Cypress", "Mocha"):
        if label in frameworks:
            tests.add(label)

    has_python_tests = any(re.search(r"(^|/)tests?/.*\.py$", name, re.I) or re.search(r"(^|/)test_.*\.py$", name, re.I) or name.lower().endswith("_test.py") for name in file_paths)
    if meta["kind"] == "python" and ("pytest" in frameworks or has_python_tests):
        tests.add("pytest")
        commands.append("python -m pytest")
    if meta["kind"] == "go" and any(name.endswith("_test.go") for name in file_paths):
        tests.add("go test")
        commands.append("go test ./...")
    if meta["kind"] == "rust":
        rust_tests = any(name.startswith("tests/") for name in file_paths)
        if not rust_tests:
            for name in [p for p in file_paths if p.endswith(".rs")][:80]:
                if re.search(r"#\[(?:tokio::)?test\]", read_text(root / name, 256 * 1024)):
                    rust_tests = True
                    break
        if rust_tests:
            tests.add("cargo test")
            commands.append("cargo test")
    if meta["kind"] == "java" and ("JUnit" in frameworks or any("/src/test/" in f"/{name}" for name in file_paths)):
        tests.add("Java tests")
        commands.append("./gradlew test" if meta["gradle"] else "mvn test")
    if meta["kind"] == "dotnet" and (any("test" in name.lower() and name.lower().endswith(".csproj") for name in file_paths) or any(label in frameworks for label in ("xUnit", "NUnit", "MSTest"))):
        tests.add("dotnet test")
        commands.append("dotnet test")
    return sorted(tests), sorted(set(commands))


def classify_sensitive_path(relative: str) -> dict | None:
    base = Path(relative).name
    lower = base.lower()
    suffix = Path(lower).suffix
    if lower.startswith(".env") and lower not in SAFE_ENV_FILES:
        return {"severity": "high", "kind": "environment-file", "message": f"{relative}: environment file may contain secrets."}
    if suffix in {".pem", ".key", ".p12", ".pfx", ".jks"} or lower in {"id_rsa", "id_ed25519"}:
        return {"severity": "high", "kind": "private-key-file", "message": f"{relative}: private key or certificate container should not be committed."}
    if suffix in {".crt", ".cer"}:
        return {"severity": "medium", "kind": "certificate-file", "message": f"{relative}: certificate file detected; verify that it is intended to be public."}
    if lower in {".npmrc", ".pypirc"}:
        return {"severity": "medium", "kind": "credential-config", "message": f"{relative}: package-manager config can contain authentication tokens."}
    if re.search(r"(^|[._-])(credentials?|secrets?|tokens?)([._-]|$)", base, re.I):
        return {"severity": "high", "kind": "credential-file", "message": f"{relative}: filename suggests credentials, tokens, or secrets."}
    if re.match(r"^(config|settings)\.local\.", base, re.I) or re.search(r"\.local\.json$", base, re.I) or lower == "local.settings.json":
        return {"severity": "medium", "kind": "local-config", "message": f"{relative}: local configuration may contain machine-specific or secret values."}
    return None


def scan_security(root: Path, files: list[dict]) -> list[dict]:
    findings = []
    seen = set()
    content_files = 0

    def add(item: dict) -> None:
        key = (item["kind"], item["message"])
        if key not in seen:
            seen.add(key)
            findings.append(item)

    for item in files:
        relative, size = item["path"], item["size"]
        path_finding = classify_sensitive_path(relative)
        if path_finding:
            add(path_finding)
        base = Path(relative).name.lower()
        suffix = Path(relative).suffix.lower()
        likely_text = size <= 512 * 1024 and (suffix in TEXT_EXTENSIONS or base.startswith(".env") or base in {"dockerfile", "makefile", ".npmrc", ".pypirc"})
        if not likely_text or content_files >= 1500:
            continue
        text = read_text(root / relative, 512 * 1024)
        content_files += 1
        for label, pattern in CONTENT_SECRET_PATTERNS:
            if pattern.search(text):
                add({"severity": "high", "kind": "secret-content", "message": f"{relative}: {label} detected. The value is intentionally not displayed."})

    order = {"high": 0, "medium": 1, "low": 2}
    return sorted(findings, key=lambda item: (order.get(item["severity"], 9), item["message"]))


def infer_purpose(meta: dict, frameworks: list[str], file_set: set[str]) -> str:
    if meta["description"].strip():
        return meta["description"].strip()
    fset = set(frameworks)
    if "Electron" in fset or {"main/main.js", "renderer/index.html"}.issubset(file_set):
        return "Desktop application built with Electron."
    if fset & {"Express", "FastAPI", "Flask", "Django", "NestJS", "Fastify"}:
        return "Web or API service."
    if fset & {"React", "Next.js", "Vue", "Svelte", "Vite"}:
        return "Web application or front-end project."
    return f"{project_type_label(meta['kind'])} project."


def readiness_score(security: list[dict], existing: list[str], tests: list[str], kind: str, explicit_description: str, file_set: set[str]) -> tuple[int, str]:
    score = 100
    deductions = {
        "README.md": 12, ".gitignore": 12, "SECURITY.md": 6, "CONTRIBUTING.md": 4,
        "CODE_OF_CONDUCT.md": 2, ".editorconfig": 2, ".github/workflows/ci.yml": 8,
        ".github/dependabot.yml": 3, ".gitleaks.toml": 5,
    }
    existing_set = set(existing)
    for repo_file, amount in deductions.items():
        if repo_file not in existing_set:
            score -= amount
    score -= min(50, sum(1 for item in security if item["severity"] == "high") * 20)
    score -= min(24, sum(1 for item in security if item["severity"] == "medium") * 8)
    if not tests:
        score -= 10
    if kind == "generic":
        score -= 5
    if not explicit_description:
        score -= 5
    private_env = any(name.startswith(".env") and name not in SAFE_ENV_FILES for name in file_set)
    if private_env and ".env.example" not in existing_set:
        score -= 5
    score = max(0, min(100, score))
    return score, "high" if score >= 80 else ("medium" if score >= 50 else "low")


def scan_project(folder: str | Path) -> dict:
    root = Path(folder).expanduser().resolve(strict=True)
    if not root.is_dir():
        raise ValueError("Selected project path is not a directory.")
    files, ignored, truncated = walk_project(root)
    file_set = {item["path"] for item in files}
    meta = parse_metadata(root, files)

    language_bytes: Counter[str] = Counter()
    for item in files:
        language = LANGUAGE_BY_EXTENSION.get(Path(item["path"]).suffix.lower())
        if language:
            language_bytes[language] += item["size"]
    languages = [name for name, _ in sorted(language_bytes.items(), key=lambda pair: (-pair[1], pair[0]))]
    frameworks = detect_frameworks(meta)
    managers = detect_package_managers(meta, file_set)
    tests, test_commands = detect_tests(meta, frameworks, managers, files, root)
    if ".project-pusher.json" in file_set:
        configured = read_json(root / ".project-pusher.json").get("testCommands", [])
        if isinstance(configured, list):
            test_commands.extend(command.strip() for command in configured if isinstance(command, str) and command.strip() and len(command) <= 500)
            test_commands = sorted(set(test_commands))
    security = scan_security(root, files)
    existing = [name for name in STANDARD_REPO_FILES if name in file_set]
    recommended = [name for name in STANDARD_REPO_FILES if name not in file_set]
    purpose = infer_purpose(meta, frameworks, file_set)
    score, readiness = readiness_score(security, existing, test_commands, meta["kind"], meta["description"], file_set)

    warnings = [item["message"] for item in security]
    if not test_commands:
        warnings.append("No runnable test command was detected.")
    if truncated:
        warnings.append("Scan limit reached; the summary may be incomplete.")

    return {
        "projectName": meta["name"], "description": purpose,
        "projectType": project_type_label(meta["kind"]), "projectTypeId": meta["kind"],
        "languages": languages, "frameworks": frameworks, "packageManagers": managers,
        "tests": tests, "testCommands": test_commands, "repoReadiness": readiness,
        "readinessScore": score, "warnings": warnings, "securityFindings": security,
        "recommendedFiles": recommended, "existingRepoFiles": existing,
        "ignoredDirectoriesPresent": ignored, "fileCount": len(files), "scanTruncated": truncated,
    }


def gitignore_text(summary: dict) -> str:
    lines = [
        "# Secrets and local configuration", ".env", ".env.*", "!.env.example", "*.pem", "*.key", "*.p12", "*.pfx",
        "", "# Operating systems and editors", ".DS_Store", "Thumbs.db", "desktop.ini", ".idea/", ".vscode/", "*.swp", "*.swo",
        "", "# Logs and temporary files", "*.log", "tmp/", "temp/",
    ]
    if summary["projectTypeId"] == "node" or set(summary["packageManagers"]) & {"npm", "yarn", "pnpm"}:
        lines += ["", "# Node / JavaScript", "node_modules/", "dist/", "build/", "coverage/", ".next/", ".nuxt/", ".output/", ".turbo/"]
    if summary["projectTypeId"] == "python" or "Python" in summary["languages"]:
        lines += ["", "# Python", "__pycache__/", "*.py[cod]", "*.egg-info/", ".venv/", "venv/", ".pytest_cache/", ".mypy_cache/", ".ruff_cache/", ".coverage", "htmlcov/"]
    if summary["projectTypeId"] == "go":
        lines += ["", "# Go", "*.test", "*.out", "vendor/"]
    if summary["projectTypeId"] == "rust":
        lines += ["", "# Rust", "target/", "**/*.rs.bk"]
    if summary["projectTypeId"] == "java":
        lines += ["", "# Java", "target/", "build/", ".gradle/", "*.class"]
    if summary["projectTypeId"] == "dotnet":
        lines += ["", "# .NET", "bin/", "obj/", ".vs/", "*.user", "*.suo"]
    return "\n".join(dict.fromkeys(lines)) + "\n"


def readme_text(summary: dict) -> str:
    stack = sorted(set(summary["languages"] + summary["frameworks"]))
    stack_lines = "\n".join(f"- {item}" for item in stack) or "- Generic project"
    tests = "\n\n".join(f"```bash\n{cmd}\n```" for cmd in summary["testCommands"]) or "No automated test command was detected."
    return f"""# {summary['projectName']}

{summary['description']}

## Project profile

{stack_lines}

## Getting started

Install the dependencies required by the detected project stack, then run the project's normal start command.

## Testing

{tests}

## Security

Never commit API tokens, passwords, credentials, private keys, or populated `.env` files. Keep only safe variable names/placeholders in `.env.example`.

See [SECURITY.md](SECURITY.md) for vulnerability reporting guidance.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
"""


def ci_text(summary: dict) -> str:
    header = """name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
"""
    kind = summary["projectTypeId"]
    if kind == "node":
        test = summary["testCommands"][0] if summary["testCommands"] else "npm test --if-present"
        return header + f"""      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: {test}
"""
    if kind == "python":
        test = summary["testCommands"][0] if summary["testCommands"] else "python -m pytest"
        return header + f"""      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: python -m pip install --upgrade pip
      - run: if [ -f requirements.txt ]; then python -m pip install -r requirements.txt; fi
      - run: {test}
"""
    if kind == "go":
        return header + "      - uses: actions/setup-go@v5\n        with:\n          go-version: stable\n      - run: go test ./...\n"
    if kind == "rust":
        return header + "      - uses: dtolnay/rust-toolchain@stable\n      - run: cargo test\n"
    if kind == "dotnet":
        return header + "      - uses: actions/setup-dotnet@v4\n        with:\n          dotnet-version: '8.0.x'\n      - run: dotnet test\n"
    if kind == "java":
        command = "./gradlew test" if "gradle" in summary["packageManagers"] else "mvn -B test"
        return header + f"      - uses: actions/setup-java@v4\n        with:\n          distribution: temurin\n          java-version: '21'\n      - run: {command}\n"
    return header + '      - run: echo "No language-specific CI command was detected."\n'


def dependabot_text(summary: dict) -> str:
    ecosystems = {"github-actions"}
    managers = set(summary["packageManagers"])
    if managers & {"npm", "yarn", "pnpm"}: ecosystems.add("npm")
    if managers & {"pip", "poetry", "pipenv"}: ecosystems.add("pip")
    if "cargo" in managers: ecosystems.add("cargo")
    if "go modules" in managers: ecosystems.add("gomod")
    if "maven" in managers: ecosystems.add("maven")
    if "gradle" in managers: ecosystems.add("gradle")
    if "dotnet" in managers: ecosystems.add("nuget")
    chunks = [f'  - package-ecosystem: "{eco}"\n    directory: "/"\n    schedule:\n      interval: weekly\n    open-pull-requests-limit: 5' for eco in sorted(ecosystems)]
    return "version: 2\nupdates:\n" + "\n".join(chunks) + "\n"


def standard_contents(summary: dict) -> dict[str, str]:
    project = summary["projectName"]
    tests = "\n".join(f"- `{cmd}`" for cmd in summary["testCommands"]) or "- Run the project-appropriate tests before submitting changes."
    return {
        ".gitignore": gitignore_text(summary),
        "README.md": readme_text(summary),
        "SECURITY.md": f"""# Security Policy

## Reporting a vulnerability

Do not disclose vulnerabilities in a public issue. Prefer GitHub private vulnerability reporting / Security Advisories. If that is unavailable, request a private maintainer contact without posting exploit details.

## Secret handling

{project} must never commit live tokens, passwords, private keys, populated `.env` files, or credentials. `.env.example` may contain variable names and safe placeholders only.
""",
        "CONTRIBUTING.md": f"""# Contributing

Keep contributions focused, reviewable, documented, and free of credentials or generated dependency folders.

## Tests

{tests}

Open a pull request explaining what changed and why. Update documentation when behavior changes.
""",
        "CODE_OF_CONDUCT.md": """# Code of Conduct

Be respectful, constructive, and safe. Harassment, threats, discriminatory abuse, deliberate disruption, publishing private information, or pressuring others to disclose credentials are not acceptable. Report serious conduct concerns privately to project maintainers.
""",
        ".editorconfig": """root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space
indent_size = 2

[*.py]
indent_size = 4

[*.go]
indent_style = tab

[Makefile]
indent_style = tab

[*.md]
trim_trailing_whitespace = false
""",
        ".github/workflows/ci.yml": ci_text(summary),
        ".github/workflows/repodoc.yml": """name: RepoDoc

on:
  workflow_dispatch:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - name: Generate RepoDoc JSON
        run: |
          if [ -f repodoc.py ]; then
            python repodoc.py . > repodoc-summary.json
          else
            python - <<'PY' > repodoc-summary.json
          import json
          from pathlib import Path
          root = Path('.')
          ignored = {'.git', 'node_modules', '.venv', 'dist', 'build', 'coverage', 'target'}
          files = sorted(str(p).replace('\\', '/') for p in root.rglob('*') if p.is_file() and not any(part in ignored for part in p.parts))
          print(json.dumps({'projectName': root.resolve().name, 'fileCount': len(files), 'files': files[:250]}, indent=2))
          PY
          fi
      - uses: actions/upload-artifact@v4
        with:
          name: repodoc-summary
          path: repodoc-summary.json
""",
        ".github/dependabot.yml": dependabot_text(summary),
        ".github/ISSUE_TEMPLATE/bug_report.md": """---
name: Bug report
about: Report a reproducible problem
title: "[Bug] "
labels: bug
assignees: ""
---

## Description

Describe the problem clearly.

## Steps to reproduce

1.
2.
3.

## Expected behavior

What did you expect?

## Environment

- Operating system:
- Runtime/version:
- Project version/commit:

## Logs

Remove tokens, credentials, personal data, and private paths before posting logs.
""",
        ".github/ISSUE_TEMPLATE/feature_request.md": """---
name: Feature request
about: Suggest an improvement
title: "[Feature] "
labels: enhancement
assignees: ""
---

## Problem

What problem should this solve?

## Proposed behavior

Describe the desired outcome.

## Security and compatibility

Note effects on credentials, data, network access, compatibility, or CI.
""",
        ".gitleaks.toml": """title = "Repository gitleaks configuration"

[extend]
useDefault = true

[[allowlists]]
description = "Safe repository examples"
paths = ['''^\\.env\\.example$''']
""",
        ".env.example": """# Safe environment-variable template.
# Never commit populated secrets.

# EXAMPLE_API_TOKEN=
# EXAMPLE_SERVICE_URL=
""",
    }


def safe_destination(root: Path, relative: str) -> Path:
    rel = Path(relative)
    if rel.is_absolute() or ".." in rel.parts:
        raise ValueError(f"Unsafe output path: {relative}")
    current = root
    for part in rel.parent.parts:
        if part == ".":
            continue
        current = current / part
        if current.exists():
            if current.is_symlink() or not current.is_dir():
                raise ValueError(f"Refusing to write through unsafe parent: {current}")
        else:
            current.mkdir()
    destination = root / rel
    parent = destination.parent.resolve(strict=True)
    try:
        parent.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"Refusing to write outside selected project: {relative}") from exc
    return destination


def generate_missing(root: Path, summary: dict) -> dict:
    created, skipped = [], []
    contents = standard_contents(summary)
    for relative in STANDARD_REPO_FILES:
        destination = safe_destination(root, relative)
        try:
            with destination.open("x", encoding="utf-8", newline="\n") as handle:
                handle.write(contents[relative])
            created.append(relative)
        except FileExistsError:
            skipped.append(relative)
    return {"created": created, "skippedExisting": skipped}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Scan a local project and print a GitHub-readiness JSON summary.")
    parser.add_argument("folder", nargs="?", default=".", help="Project folder to scan")
    parser.add_argument("--generate", action="store_true", help="Create missing standard repo files without overwriting existing files")
    parser.add_argument("--output", help="Also write the JSON summary to this file")
    parser.add_argument("--compact", action="store_true", help="Print compact JSON instead of indented JSON")
    return parser


def main(argv: Iterable[str] | None = None) -> int:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    try:
        root = Path(args.folder).expanduser().resolve(strict=True)
        summary = scan_project(root)
        generation = None
        if args.generate:
            generation = generate_missing(root, summary)
            summary = scan_project(root)
            summary["generation"] = generation
        payload = json.dumps(summary, ensure_ascii=False, sort_keys=True, indent=None if args.compact else 2)
        print(payload)
        if args.output:
            destination = Path(args.output).expanduser().resolve()
            destination.write_text(payload + "\n", encoding="utf-8")
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
