'use strict';

const fs = require('fs');
const path = require('path');
const { isSensitiveGenerationTarget } = require('./security-checks');

const FILE_OPTION_MAP = {
  gitignore: '.gitignore',
  readme: 'README.md',
  security: 'SECURITY.md',
  contributing: 'CONTRIBUTING.md',
  codeOfConduct: 'CODE_OF_CONDUCT.md',
  editorconfig: '.editorconfig',
  ci: '.github/workflows/ci.yml',
  repodoc: '.github/workflows/repodoc.yml',
  dependabot: '.github/dependabot.yml',
  bugTemplate: '.github/ISSUE_TEMPLATE/bug_report.md',
  featureTemplate: '.github/ISSUE_TEMPLATE/feature_request.md',
  gitleaks: '.gitleaks.toml',
  envExample: '.env.example',
  changelog: 'CHANGELOG.md',
  license: 'LICENSE'
};

function clean(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function yamlQuote(value) {
  return JSON.stringify(String(value));
}

function shellInstallLines(scan) {
  const managers = new Set(scan.packageManagers || []);
  if (managers.has('pnpm')) return ['corepack enable', 'pnpm install --frozen-lockfile'];
  if (managers.has('yarn')) return ['corepack enable', 'yarn install --immutable'];
  if (managers.has('npm')) return ['npm ci'];
  if (managers.has('poetry')) return ['poetry install'];
  if (managers.has('pipenv')) return ['pipenv install --dev'];
  if (managers.has('pip')) return ['python -m pip install --upgrade pip', 'python -m pip install -r requirements.txt'];
  if (managers.has('cargo')) return ['cargo build'];
  if (managers.has('go modules')) return ['go mod download'];
  if (managers.has('maven')) return ['mvn -B -DskipTests package'];
  if (managers.has('gradle')) return ['./gradlew assemble'];
  if (managers.has('dotnet')) return ['dotnet restore'];
  return [];
}

function readmeTemplate(scan, options) {
  const projectName = clean(options.projectName, scan.projectName || 'Project');
  const description = clean(options.description, scan.description || 'Repository prepared with Project Pusher.');
  const stack = [
    ...(scan.languages || []),
    ...(scan.frameworks || [])
  ];
  const install = shellInstallLines(scan);
  const tests = scan.testCommands || [];
  const stackSection = stack.length ? stack.map((item) => `- ${item}`).join('\n') : '- Generic project';
  const installSection = install.length ? `\`\`\`bash\n${install.join('\n')}\n\`\`\`` : 'Follow the project-specific setup instructions for your environment.';
  const testsSection = tests.length ? tests.map((command) => `\`\`\`bash\n${command}\n\`\`\``).join('\n\n') : 'No automated test command was detected during repository preparation.';

  return `# ${projectName}\n\n${description}\n\n## Project profile\n\n${stackSection}\n\n## Getting started\n\nClone the repository and install its dependencies.\n\n${installSection}\n\n## Usage\n\nRun the project using the normal command for the detected stack. Update this section with project-specific examples as the repository evolves.\n\n## Testing\n\n${testsSection}\n\n## Security\n\nNever commit API tokens, passwords, credentials, private keys, certificates containing private material, or populated \`.env\` files. Use \`.env.example\` only for variable names and safe placeholder values.\n\nFor vulnerability reporting, see [SECURITY.md](SECURITY.md).\n\n## Contributing\n\nContributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before opening a pull request.\n\n## License\n\nSee the repository's \`LICENSE\` file when present.\n`;
}

function gitignoreTemplate(scan) {
  const lines = new Set([
    '# Secrets and local configuration',
    '.env', '.env.*', '!.env.example', '*.pem', '*.key', '*.p12', '*.pfx',
    '', '# Operating systems and editors', '.DS_Store', 'Thumbs.db', 'desktop.ini', '.idea/', '.vscode/', '*.swp', '*.swo',
    '', '# Logs and temporary files', '*.log', 'tmp/', 'temp/'
  ]);

  const languages = new Set(scan.languages || []);
  const managers = new Set(scan.packageManagers || []);
  if (scan.projectTypeId === 'node' || managers.has('npm') || managers.has('yarn') || managers.has('pnpm')) {
    ['','## Node / JavaScript','node_modules/','dist/','build/','coverage/','.next/','.nuxt/','.output/','.turbo/','.parcel-cache/','npm-debug.log*','yarn-error.log*','.pnpm-debug.log*'].forEach((line) => lines.add(line));
  }
  if (scan.projectTypeId === 'python' || languages.has('Python')) {
    ['','## Python','__pycache__/','*.py[cod]','*.egg-info/','.venv/','venv/','.pytest_cache/','.mypy_cache/','.ruff_cache/','.coverage','htmlcov/','dist/','build/'].forEach((line) => lines.add(line));
  }
  if (scan.projectTypeId === 'go' || languages.has('Go')) {
    ['','## Go','*.test','*.out','vendor/'].forEach((line) => lines.add(line));
  }
  if (scan.projectTypeId === 'rust' || languages.has('Rust')) {
    ['','## Rust','target/','**/*.rs.bk'].forEach((line) => lines.add(line));
  }
  if (scan.projectTypeId === 'java' || languages.has('Java')) {
    ['','## Java / JVM','target/','build/','.gradle/','*.class'].forEach((line) => lines.add(line));
  }
  if (scan.projectTypeId === 'dotnet' || languages.has('C#')) {
    ['','## .NET','bin/','obj/','.vs/','*.user','*.suo'].forEach((line) => lines.add(line));
  }

  return `${[...lines].join('\n')}\n`;
}

function securityTemplate(projectName) {
  return `# Security Policy\n\n## Reporting a vulnerability\n\nPlease do not disclose vulnerabilities in a public issue. Use GitHub's private vulnerability reporting / Security Advisory feature when it is enabled for this repository. If private reporting is unavailable, open a minimal public issue asking the maintainers for a private contact channel and do not include exploit details or secrets.\n\nInclude enough information to reproduce and assess the issue, but remove tokens, passwords, personal data, private keys, and other credentials from logs and screenshots.\n\n## Secret handling\n\n${projectName} must never store or commit live API tokens, passwords, private keys, populated \`.env\` files, or credentials. Use environment variables or an operating-system credential store for runtime secrets. \`.env.example\` may contain names and safe placeholders only.\n\n## Supported code\n\nSecurity fixes are applied to the current maintained branch unless the repository documents additional supported releases.\n`;
}

function contributingTemplate(scan) {
  const tests = scan.testCommands || [];
  const testBlock = tests.length ? tests.map((command) => `- \`${command}\``).join('\n') : '- Add or run the project-appropriate tests before submitting changes.';
  return `# Contributing\n\nThank you for contributing. Keep changes focused, reviewable, and secure.\n\n## Workflow\n\n1. Fork the repository or create a feature branch.\n2. Make the smallest change that solves the problem.\n3. Do not add secrets, credentials, generated dependency folders, or unrelated build output.\n4. Run the relevant checks.\n5. Open a pull request describing what changed and why.\n\n## Tests\n\n${testBlock}\n\n## Pull requests\n\n- Explain user-visible and security-relevant behavior.\n- Update documentation when behavior changes.\n- Keep generated files deterministic.\n- Avoid force-pushing over other contributors' work unless coordinated.\n\n## Commit hygiene\n\nUse clear, imperative commit messages. Conventional Commit prefixes such as \`feat:\`, \`fix:\`, \`docs:\`, and \`test:\` are welcome but not required.\n`;
}

function codeOfConductTemplate() {
  return `# Code of Conduct\n\n## Our standard\n\nWe want participation in this project to be respectful, constructive, and safe. Treat other contributors with dignity, discuss ideas rather than attacking people, and assume good faith while still addressing technical and security concerns clearly.\n\nUnacceptable behavior includes harassment, threats, discriminatory abuse, sexualized conduct, deliberate disruption, publishing another person's private information, or pressuring others to disclose credentials or personal data.\n\n## Project spaces\n\nThese expectations apply to issues, pull requests, discussions, reviews, and other project-managed spaces. Maintainers may edit or remove content, restrict participation, or take other proportionate action when necessary to protect contributors and the project.\n\n## Reporting conduct problems\n\nReport serious conduct concerns privately to the repository maintainers. Do not include unrelated personal information in reports.\n`;
}

function editorconfigTemplate() {
  return `root = true\n\n[*]\ncharset = utf-8\nend_of_line = lf\ninsert_final_newline = true\ntrim_trailing_whitespace = true\nindent_style = space\nindent_size = 2\n\n[*.py]\nindent_size = 4\n\n[*.go]\nindent_style = tab\n\n[Makefile]\nindent_style = tab\n\n[*.md]\ntrim_trailing_whitespace = false\n`;
}

function ciTemplate(scan) {
  const type = scan.projectTypeId;
  const testCommands = scan.testCommands || [];

  const header = `name: CI\n\non:\n  push:\n    branches: [main]\n  pull_request:\n\npermissions:\n  contents: read\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Check out repository\n        uses: actions/checkout@v4\n`;

  if (type === 'node') {
    const manager = (scan.packageManagers || []).find((name) => ['npm', 'yarn', 'pnpm'].includes(name)) || 'npm';
    const install = manager === 'npm' ? 'npm ci' : (manager === 'yarn' ? 'yarn install --immutable' : 'pnpm install --frozen-lockfile');
    const setupExtra = manager === 'npm' ? '' : '      - name: Enable Corepack\n        run: corepack enable\n';
    const tests = testCommands.length ? testCommands.map((command) => `      - name: Run ${yamlQuote(command)}\n        run: ${command}`).join('\n') : '      - name: Run package tests when present\n        run: npm test --if-present';
    const cacheLine = manager === 'npm' ? '          cache: npm\n' : '';
    return `${header}      - name: Set up Node.js\n        uses: actions/setup-node@v4\n        with:\n          node-version: 22\n${cacheLine}${setupExtra}      - name: Install dependencies\n        run: ${install}\n${tests}\n`;
  }

  if (type === 'python') {
    const install = (scan.packageManagers || []).includes('poetry')
      ? 'python -m pip install poetry && poetry install'
      : 'python -m pip install --upgrade pip\n          if [ -f requirements.txt ]; then python -m pip install -r requirements.txt; fi\n          if [ -f pyproject.toml ]; then python -m pip install -e .; fi';
    const test = testCommands[0] || 'python -m pytest';
    return `${header}      - name: Set up Python\n        uses: actions/setup-python@v5\n        with:\n          python-version: '3.12'\n      - name: Install dependencies\n        shell: bash\n        run: |\n          ${install}\n      - name: Run tests\n        run: ${test}\n`;
  }

  if (type === 'go') return `${header}      - name: Set up Go\n        uses: actions/setup-go@v5\n        with:\n          go-version: 'stable'\n          cache: true\n      - run: go test ./...\n`;
  if (type === 'rust') return `${header}      - name: Set up Rust\n        uses: dtolnay/rust-toolchain@stable\n      - run: cargo test\n`;
  if (type === 'java') {
    const gradle = (scan.packageManagers || []).includes('gradle');
    return `${header}      - name: Set up Java\n        uses: actions/setup-java@v4\n        with:\n          distribution: temurin\n          java-version: '21'\n          cache: ${gradle ? 'gradle' : 'maven'}\n      - run: ${gradle ? './gradlew test' : 'mvn -B test'}\n`;
  }
  if (type === 'dotnet') return `${header}      - name: Set up .NET\n        uses: actions/setup-dotnet@v4\n        with:\n          dotnet-version: '8.0.x'\n      - run: dotnet restore\n      - run: dotnet test --no-restore\n`;

  return `${header}      - name: Repository check\n        run: echo "No language-specific CI command was detected."\n`;
}

function repodocWorkflowTemplate() {
  return `name: RepoDoc\n\non:\n  workflow_dispatch:\n  push:\n    branches: [main]\n\npermissions:\n  contents: read\n\njobs:\n  scan:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-python@v5\n        with:\n          python-version: '3.12'\n      - name: Generate repository summary\n        shell: bash\n        run: |\n          if [ -f repodoc.py ]; then\n            python repodoc.py . > repodoc-summary.json\n          else\n            python - <<'PY'\n          import json\n          from pathlib import Path\n          root = Path('.')\n          ignored = {'.git', 'node_modules', '.venv', 'dist', 'build', 'coverage', 'target'}\n          files = sorted(str(p).replace('\\\\', '/') for p in root.rglob('*') if p.is_file() and not any(part in ignored for part in p.parts))\n          print(json.dumps({'projectName': root.resolve().name, 'fileCount': len(files), 'files': files[:250]}, indent=2))\n          PY\n          fi\n      - name: Upload RepoDoc summary\n        uses: actions/upload-artifact@v4\n        with:\n          name: repodoc-summary\n          path: repodoc-summary.json\n`;
}

function dependabotTemplate(scan) {
  const ecosystems = new Set(['github-actions']);
  const managers = new Set(scan.packageManagers || []);
  if (['npm', 'yarn', 'pnpm'].some((name) => managers.has(name))) ecosystems.add('npm');
  if (['pip', 'poetry', 'pipenv'].some((name) => managers.has(name))) ecosystems.add('pip');
  if (managers.has('cargo')) ecosystems.add('cargo');
  if (managers.has('go modules')) ecosystems.add('gomod');
  if (managers.has('maven')) ecosystems.add('maven');
  if (managers.has('gradle')) ecosystems.add('gradle');
  if (managers.has('dotnet')) ecosystems.add('nuget');

  const updates = [...ecosystems].sort().map((ecosystem) => `  - package-ecosystem: ${yamlQuote(ecosystem)}\n    directory: "/"\n    schedule:\n      interval: weekly\n    open-pull-requests-limit: 5`).join('\n');
  return `version: 2\nupdates:\n${updates}\n`;
}

function bugTemplate() {
  return `---\nname: Bug report\nabout: Report a reproducible problem\ntitle: "[Bug] "\nlabels: bug\nassignees: ""\n---\n\n## Description\n\nDescribe the problem clearly.\n\n## Steps to reproduce\n\n1.\n2.\n3.\n\n## Expected behavior\n\nWhat did you expect to happen?\n\n## Environment\n\n- Operating system:\n- Runtime/version:\n- Project version/commit:\n\n## Logs\n\nPaste only the minimum relevant output. Remove tokens, credentials, personal data, and private paths before posting.\n`;
}

function featureTemplate() {
  return `---\nname: Feature request\nabout: Suggest an improvement\ntitle: "[Feature] "\nlabels: enhancement\nassignees: ""\n---\n\n## Problem\n\nWhat problem would this feature solve?\n\n## Proposed behavior\n\nDescribe the desired outcome rather than only an implementation.\n\n## Alternatives\n\nDescribe any alternatives you considered.\n\n## Security and compatibility\n\nNote any effect on stored data, credentials, network access, backwards compatibility, or CI.\n`;
}

function gitleaksTemplate() {
  return `title = "Repository gitleaks configuration"\n\n[extend]\nuseDefault = true\n\n[[allowlists]]\ndescription = "Safe repository examples"\npaths = [\n  '''^\\.env\\.example$''',\n]\n`;
}

function envExampleTemplate() {
  return `# Safe environment-variable template.\n# Copy to .env locally only when the project needs it. Never commit populated secrets.\n\n# EXAMPLE_API_TOKEN=\n# EXAMPLE_SERVICE_URL=\n`;
}

function changelogTemplate() {
  return `# Changelog\n\nAll notable changes to this project should be documented here.\n\nThe format is inspired by Keep a Changelog and the project should document its versioning policy when releases begin.\n`;
}

function licenseTemplate(options) {
  const year = clean(options.year, String(new Date().getFullYear()));
  const author = clean(options.author, 'Project contributors');
  const license = clean(options.license, 'MIT');
  const allowed = new Set(['MIT', 'Apache-2.0', 'GPL-3.0']);
  if (!allowed.has(license)) throw new Error(`Unsupported license template: ${license}`);

  const templatePath = path.join(__dirname, '..', 'templates', `license-${license}.txt`);
  const template = fs.readFileSync(templatePath, 'utf8');
  return template
    .replace(/\{\{YEAR\}\}/g, year)
    .replace(/\{\{AUTHOR\}\}/g, author);
}

function contentFor(relativePath, scan, options) {
  const projectName = clean(options.projectName, scan.projectName || 'Project');
  const content = {
    '.gitignore': () => gitignoreTemplate(scan),
    'README.md': () => readmeTemplate(scan, options),
    'SECURITY.md': () => securityTemplate(projectName),
    'CONTRIBUTING.md': () => contributingTemplate(scan),
    'CODE_OF_CONDUCT.md': codeOfConductTemplate,
    '.editorconfig': editorconfigTemplate,
    '.github/workflows/ci.yml': () => ciTemplate(scan),
    '.github/workflows/repodoc.yml': repodocWorkflowTemplate,
    '.github/dependabot.yml': () => dependabotTemplate(scan),
    '.github/ISSUE_TEMPLATE/bug_report.md': bugTemplate,
    '.github/ISSUE_TEMPLATE/feature_request.md': featureTemplate,
    '.gitleaks.toml': gitleaksTemplate,
    '.env.example': envExampleTemplate,
    'CHANGELOG.md': changelogTemplate,
    'LICENSE': () => licenseTemplate(options)
  };
  if (!content[relativePath]) throw new Error(`No generator is registered for ${relativePath}.`);
  return content[relativePath]();
}

function assertSafeRelativePath(relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error('Generated file path must be relative.');
  const normalized = path.normalize(relativePath);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) throw new Error('Generated file path escapes the selected project.');
  if (isSensitiveGenerationTarget(relativePath)) throw new Error(`Refusing to generate sensitive file: ${relativePath}`);
  return normalized;
}

function ensureSafeParentDirectory(root, relativePath) {
  const normalized = assertSafeRelativePath(relativePath);
  const parentParts = path.dirname(normalized).split(path.sep).filter((part) => part && part !== '.');
  let current = root;
  for (const part of parentParts) {
    current = path.join(current, part);
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) throw new Error(`Refusing to write through symbolic-link directory: ${current}`);
      if (!stat.isDirectory()) throw new Error(`Expected directory but found file: ${current}`);
    } else {
      fs.mkdirSync(current);
    }
  }
  return path.join(root, normalized);
}

function writeNewFile(root, relativePath, content) {
  const destination = ensureSafeParentDirectory(root, relativePath);
  const rootReal = fs.realpathSync(root);
  const parentReal = fs.realpathSync(path.dirname(destination));
  if (parentReal !== rootReal && !parentReal.startsWith(`${rootReal}${path.sep}`)) {
    throw new Error(`Refusing to write outside selected project: ${relativePath}`);
  }
  let handle;
  try {
    handle = fs.openSync(destination, 'wx', 0o644);
    fs.writeFileSync(handle, content, 'utf8');
  } catch (error) {
    if (error.code === 'EEXIST') return { status: 'skipped-existing', path: relativePath };
    throw error;
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
  return { status: 'created', path: relativePath };
}

function generateRepoFiles(folderPath, scan, options = {}) {
  const root = fs.realpathSync(path.resolve(folderPath));
  const files = options.files || {};
  const requested = [];
  for (const [optionKey, relativePath] of Object.entries(FILE_OPTION_MAP)) {
    if (files[optionKey]) requested.push(relativePath);
  }

  const created = [];
  const skippedExisting = [];
  for (const relativePath of requested) {
    const result = writeNewFile(root, relativePath, contentFor(relativePath, scan, options));
    if (result.status === 'created') created.push(relativePath);
    else skippedExisting.push(relativePath);
  }

  return {
    created,
    skippedExisting,
    message: `${created.length} file(s) created; ${skippedExisting.length} existing file(s) left unchanged.`
  };
}

module.exports = {
  FILE_OPTION_MAP,
  generateRepoFiles,
  contentFor,
  writeNewFile
};
