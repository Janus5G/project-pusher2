'use strict';

const fs = require('fs');
const path = require('path');
const { scanSecurityRisks } = require('./security-checks');

const IGNORE_DIRS = new Set([
  '.git', 'node_modules', '.venv', 'venv', 'env', '__pycache__', 'dist', 'build',
  'coverage', '.coverage', 'target', 'bin', 'obj', '.next', '.nuxt', '.output',
  '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.nox', '.gradle',
  '.idea', '.vscode', '.cache', '.turbo', '.parcel-cache', 'vendor', 'out',
  'release', 'releases', 'tmp', 'temp'
]);

const LANGUAGE_BY_EXTENSION = new Map([
  ['.js', 'JavaScript'], ['.cjs', 'JavaScript'], ['.mjs', 'JavaScript'], ['.jsx', 'JavaScript'],
  ['.ts', 'TypeScript'], ['.tsx', 'TypeScript'], ['.py', 'Python'], ['.pyi', 'Python'],
  ['.go', 'Go'], ['.rs', 'Rust'], ['.java', 'Java'], ['.kt', 'Kotlin'], ['.kts', 'Kotlin'],
  ['.cs', 'C#'], ['.fs', 'F#'], ['.vb', 'Visual Basic .NET'], ['.cpp', 'C++'], ['.cc', 'C++'],
  ['.cxx', 'C++'], ['.c', 'C'], ['.h', 'C/C++'], ['.hpp', 'C++'], ['.rb', 'Ruby'],
  ['.php', 'PHP'], ['.swift', 'Swift'], ['.scala', 'Scala'], ['.dart', 'Dart'],
  ['.vue', 'Vue'], ['.svelte', 'Svelte'], ['.html', 'HTML'], ['.css', 'CSS'], ['.scss', 'SCSS'],
  ['.sh', 'Shell'], ['.ps1', 'PowerShell'], ['.sql', 'SQL']
]);

const STANDARD_REPO_FILES = [
  '.gitignore',
  'README.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  '.editorconfig',
  '.github/workflows/ci.yml',
  '.github/workflows/repodoc.yml',
  '.github/dependabot.yml',
  '.github/ISSUE_TEMPLATE/bug_report.md',
  '.github/ISSUE_TEMPLATE/feature_request.md',
  '.gitleaks.toml',
  '.env.example'
];

function posixPath(value) {
  return value.split(path.sep).join('/');
}

async function safeReadText(filePath, maxBytes = 1024 * 1024) {
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size > maxBytes) return '';
    return await fs.promises.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function safeReadJson(filePath) {
  const text = await safeReadText(filePath);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function walkProject(root, options = {}) {
  const maxFiles = options.maxFiles || 15000;
  const maxDepth = options.maxDepth || 40;
  const stack = [{ absolute: root, relative: '', depth: 0 }];
  const files = [];
  const ignoredDirectoriesPresent = new Set();
  let truncated = false;

  while (stack.length) {
    const current = stack.pop();
    if (current.depth > maxDepth) {
      truncated = true;
      continue;
    }

    let entries;
    try {
      entries = await fs.promises.readdir(current.absolute, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relative = current.relative ? path.join(current.relative, entry.name) : entry.name;
      const normalized = posixPath(relative);
      const absolute = path.join(current.absolute, entry.name);

      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) {
          ignoredDirectoriesPresent.add(normalized);
          continue;
        }
        stack.push({ absolute, relative, depth: current.depth + 1 });
        continue;
      }

      if (!entry.isFile()) continue;
      try {
        const stat = await fs.promises.stat(absolute);
        files.push({ path: normalized, size: stat.size });
      } catch {
        continue;
      }

      if (files.length >= maxFiles) {
        truncated = true;
        stack.length = 0;
        break;
      }
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, ignoredDirectoriesPresent: [...ignoredDirectoriesPresent].sort(), truncated };
}

function dependenciesFromPackage(packageJson) {
  return new Set([
    ...Object.keys(packageJson?.dependencies || {}),
    ...Object.keys(packageJson?.devDependencies || {}),
    ...Object.keys(packageJson?.peerDependencies || {})
  ].map((name) => name.toLowerCase()));
}

function addFrameworksFromDependencies(frameworks, deps) {
  const hints = new Map([
    ['electron', 'Electron'], ['react', 'React'], ['vite', 'Vite'], ['next', 'Next.js'],
    ['express', 'Express'], ['@nestjs/core', 'NestJS'], ['vue', 'Vue'], ['svelte', 'Svelte'],
    ['jest', 'Jest'], ['vitest', 'Vitest'], ['@playwright/test', 'Playwright'],
    ['playwright', 'Playwright'], ['cypress', 'Cypress'], ['mocha', 'Mocha'],
    ['fastify', 'Fastify'], ['typescript', 'TypeScript']
  ]);
  for (const [dependency, label] of hints) {
    if (deps.has(dependency)) frameworks.add(label);
  }
}

function detectFromPythonText(frameworks, text) {
  const lower = text.toLowerCase();
  const hints = [
    ['fastapi', 'FastAPI'], ['flask', 'Flask'], ['django', 'Django'], ['pytest', 'pytest'],
    ['uvicorn', 'Uvicorn'], ['pydantic', 'Pydantic'], ['sqlalchemy', 'SQLAlchemy'],
    ['poetry', 'Poetry'], ['playwright', 'Playwright']
  ];
  for (const [needle, label] of hints) if (lower.includes(needle)) frameworks.add(label);
}

function meaningfulNpmTest(script) {
  if (!script || typeof script !== 'string') return false;
  const lower = script.toLowerCase();
  return !lower.includes('no test specified') && !lower.includes('exit 1');
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function projectTypeLabel(type) {
  return {
    node: 'Node', python: 'Python', go: 'Go', rust: 'Rust', java: 'Java',
    dotnet: '.NET', generic: 'Generic'
  }[type] || 'Generic';
}

async function detectMetadata(root, files) {
  const fileSet = new Set(files.map((entry) => entry.path));
  const packageJson = fileSet.has('package.json') ? await safeReadJson(path.join(root, 'package.json')) : null;
  const packageDeps = dependenciesFromPackage(packageJson || {});
  const pyproject = fileSet.has('pyproject.toml') ? await safeReadText(path.join(root, 'pyproject.toml')) : '';
  const requirements = fileSet.has('requirements.txt') ? await safeReadText(path.join(root, 'requirements.txt')) : '';
  const cargo = fileSet.has('Cargo.toml') ? await safeReadText(path.join(root, 'Cargo.toml')) : '';
  const goMod = fileSet.has('go.mod') ? await safeReadText(path.join(root, 'go.mod')) : '';
  const pom = fileSet.has('pom.xml') ? await safeReadText(path.join(root, 'pom.xml')) : '';
  const gradlePath = fileSet.has('build.gradle.kts') ? 'build.gradle.kts' : (fileSet.has('build.gradle') ? 'build.gradle' : null);
  const gradle = gradlePath ? await safeReadText(path.join(root, gradlePath)) : '';
  const csprojPath = files.find((entry) => entry.path.split('/').length === 1 && entry.path.toLowerCase().endsWith('.csproj'))?.path;
  const csproj = csprojPath ? await safeReadText(path.join(root, csprojPath)) : '';

  let type = 'generic';
  if (fileSet.has('package.json')) type = 'node';
  else if (pyproject || requirements || fileSet.has('setup.py') || fileSet.has('Pipfile')) type = 'python';
  else if (goMod) type = 'go';
  else if (cargo) type = 'rust';
  else if (pom || gradle) type = 'java';
  else if (csprojPath || fileSet.has('global.json') || files.some((entry) => entry.path.endsWith('.sln'))) type = 'dotnet';

  let projectName = packageJson?.name || path.basename(root);
  let description = packageJson?.description || '';

  if (type === 'python' && pyproject) {
    const projectBlock = pyproject.match(/\[project\]([\s\S]*?)(?=\n\[|$)/)?.[1] || pyproject.match(/\[tool\.poetry\]([\s\S]*?)(?=\n\[|$)/)?.[1] || '';
    projectName = projectBlock.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1] || projectName;
    description = projectBlock.match(/^\s*description\s*=\s*["']([^"']+)["']/m)?.[1] || description;
  }
  if (type === 'rust' && cargo) {
    const packageBlock = cargo.match(/\[package\]([\s\S]*?)(?=\n\[|$)/)?.[1] || '';
    projectName = packageBlock.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1] || projectName;
    description = packageBlock.match(/^\s*description\s*=\s*["']([^"']+)["']/m)?.[1] || description;
  }
  if (type === 'go' && goMod) {
    const moduleName = goMod.match(/^\s*module\s+(\S+)/m)?.[1];
    if (moduleName) projectName = moduleName.split('/').pop();
  }

  return {
    type,
    packageJson,
    packageDeps,
    pyproject,
    requirements,
    cargo,
    goMod,
    pom,
    gradle,
    csproj,
    projectName,
    description
  };
}

function inferPurpose(metadata, frameworks, files) {
  if (metadata.description) return metadata.description.trim();
  const frameworkSet = new Set(frameworks);
  const fileSet = new Set(files.map((entry) => entry.path.toLowerCase()));

  if (frameworkSet.has('Electron') || (fileSet.has('main/main.js') && fileSet.has('renderer/index.html'))) {
    return 'Desktop application built with Electron.';
  }
  if (['Express', 'FastAPI', 'Flask', 'Django', 'NestJS', 'Fastify'].some((name) => frameworkSet.has(name))) {
    return 'Web or API service.';
  }
  if (['React', 'Next.js', 'Vue', 'Svelte', 'Vite'].some((name) => frameworkSet.has(name))) {
    return 'Web application or front-end project.';
  }
  if (metadata.packageJson?.bin || frameworkSet.has('Poetry') || /\b(?:click|typer)\b/i.test(metadata.pyproject + metadata.requirements)) {
    return 'Command-line application or developer tool.';
  }
  return `${projectTypeLabel(metadata.type)} project.`;
}

function scoreReadiness({ securityFindings, existingRepoFiles, testCommands, type, description, fileSet }) {
  let score = 100;
  const existing = new Set(existingRepoFiles);
  const deductions = new Map([
    ['README.md', 12], ['.gitignore', 12], ['SECURITY.md', 6], ['CONTRIBUTING.md', 4],
    ['CODE_OF_CONDUCT.md', 2], ['.editorconfig', 2], ['.github/workflows/ci.yml', 8],
    ['.github/dependabot.yml', 3], ['.gitleaks.toml', 5]
  ]);
  for (const [repoFile, amount] of deductions) if (!existing.has(repoFile)) score -= amount;

  const highCount = securityFindings.filter((finding) => finding.severity === 'high').length;
  const mediumCount = securityFindings.filter((finding) => finding.severity === 'medium').length;
  score -= Math.min(50, highCount * 20);
  score -= Math.min(24, mediumCount * 8);

  if (!testCommands.length) score -= 10;
  if (type === 'generic') score -= 5;
  if (!description) score -= 5;

  const hasPrivateEnv = [...fileSet].some((file) => file.startsWith('.env') && !['.env.example', '.env.sample', '.env.template'].includes(file));
  if (hasPrivateEnv && !existing.has('.env.example')) score -= 5;

  score = Math.max(0, Math.min(100, score));
  const label = score >= 80 ? 'high' : (score >= 50 ? 'medium' : 'low');
  return { score, label };
}

async function scanProject(folderPath, options = {}) {
  const root = await fs.promises.realpath(path.resolve(folderPath));
  const stat = await fs.promises.stat(root);
  if (!stat.isDirectory()) throw new Error('Selected project path is not a directory.');

  const walk = await walkProject(root, options);
  const files = walk.files;
  const fileSet = new Set(files.map((entry) => entry.path));
  const metadata = await detectMetadata(root, files);

  const languageStats = new Map();
  for (const entry of files) {
    const language = LANGUAGE_BY_EXTENSION.get(path.extname(entry.path).toLowerCase());
    if (!language) continue;
    const current = languageStats.get(language) || { files: 0, bytes: 0 };
    current.files += 1;
    current.bytes += entry.size;
    languageStats.set(language, current);
  }
  const languages = [...languageStats.entries()]
    .sort((a, b) => (b[1].bytes - a[1].bytes) || a[0].localeCompare(b[0]))
    .map(([language]) => language);

  const frameworks = new Set();
  addFrameworksFromDependencies(frameworks, metadata.packageDeps);
  detectFromPythonText(frameworks, `${metadata.pyproject}\n${metadata.requirements}`);

  const rustLower = metadata.cargo.toLowerCase();
  for (const [needle, label] of [['tokio', 'Tokio'], ['axum', 'Axum'], ['actix-web', 'Actix Web'], ['rocket', 'Rocket'], ['clap', 'Clap']]) {
    if (rustLower.includes(needle)) frameworks.add(label);
  }
  const goLower = metadata.goMod.toLowerCase();
  for (const [needle, label] of [['gin-gonic/gin', 'Gin'], ['labstack/echo', 'Echo'], ['gofiber/fiber', 'Fiber'], ['spf13/cobra', 'Cobra']]) {
    if (goLower.includes(needle)) frameworks.add(label);
  }
  const javaLower = `${metadata.pom}\n${metadata.gradle}`.toLowerCase();
  for (const [needle, label] of [['spring-boot', 'Spring Boot'], ['junit', 'JUnit'], ['quarkus', 'Quarkus']]) {
    if (javaLower.includes(needle)) frameworks.add(label);
  }
  const dotnetLower = metadata.csproj.toLowerCase();
  for (const [needle, label] of [['microsoft.aspnetcore', 'ASP.NET Core'], ['xunit', 'xUnit'], ['nunit', 'NUnit'], ['mstest', 'MSTest']]) {
    if (dotnetLower.includes(needle)) frameworks.add(label);
  }

  const packageManagers = [];
  if (fileSet.has('pnpm-lock.yaml')) packageManagers.push('pnpm');
  else if (fileSet.has('yarn.lock')) packageManagers.push('yarn');
  else if (fileSet.has('package-lock.json') || metadata.packageJson) packageManagers.push('npm');
  if (fileSet.has('poetry.lock') || /\[tool\.poetry\]/.test(metadata.pyproject)) packageManagers.push('poetry');
  else if (fileSet.has('Pipfile')) packageManagers.push('pipenv');
  else if (metadata.pyproject || metadata.requirements) packageManagers.push('pip');
  if (metadata.cargo) packageManagers.push('cargo');
  if (metadata.goMod) packageManagers.push('go modules');
  if (metadata.pom) packageManagers.push('maven');
  if (metadata.gradle) packageManagers.push('gradle');
  if (metadata.csproj || files.some((entry) => entry.path.endsWith('.sln'))) packageManagers.push('dotnet');

  const tests = new Set();
  const testCommands = [];
  const projectPusherConfig = fileSet.has('.project-pusher.json')
    ? await safeReadJson(path.join(root, '.project-pusher.json'))
    : null;
  const npmManager = packageManagers.find((name) => ['npm', 'yarn', 'pnpm'].includes(name)) || 'npm';
  if (meaningfulNpmTest(metadata.packageJson?.scripts?.test)) {
    tests.add('npm test');
    testCommands.push(npmManager === 'npm' ? 'npm test' : `${npmManager} test`);
  }
  for (const [dep, label] of [['jest', 'Jest'], ['vitest', 'Vitest'], ['@playwright/test', 'Playwright'], ['playwright', 'Playwright'], ['cypress', 'Cypress'], ['mocha', 'Mocha']]) {
    if (metadata.packageDeps.has(dep)) tests.add(label);
  }
  const hasPythonTests = files.some((entry) => /(^|\/)tests?\/.*\.py$/i.test(entry.path) || /(^|\/)test_.*\.py$/i.test(entry.path) || /_test\.py$/i.test(entry.path));
  if ((frameworks.has('pytest') || hasPythonTests) && metadata.type === 'python') {
    tests.add('pytest');
    testCommands.push('python -m pytest');
  }
  if (metadata.type === 'go' && files.some((entry) => entry.path.endsWith('_test.go'))) {
    tests.add('go test');
    testCommands.push('go test ./...');
  }
  if (metadata.type === 'rust' && (files.some((entry) => entry.path.startsWith('tests/')) || files.some((entry) => entry.path.endsWith('.rs')))) {
    const rustSamples = files.filter((entry) => entry.path.endsWith('.rs')).slice(0, 80);
    let hasRustTests = files.some((entry) => entry.path.startsWith('tests/'));
    if (!hasRustTests) {
      for (const entry of rustSamples) {
        const text = await safeReadText(path.join(root, entry.path), 256 * 1024);
        if (/\#\[(?:tokio::)?test\]/.test(text)) { hasRustTests = true; break; }
      }
    }
    if (hasRustTests) {
      tests.add('cargo test');
      testCommands.push('cargo test');
    }
  }
  const javaTests = files.some((entry) => /(^|\/)src\/test\//i.test(entry.path)) || frameworks.has('JUnit');
  if (metadata.type === 'java' && javaTests) {
    tests.add('Java tests');
    testCommands.push(metadata.gradle ? './gradlew test' : 'mvn test');
  }
  const dotnetTests = files.some((entry) => /tests?/i.test(entry.path) && entry.path.toLowerCase().endsWith('.csproj')) || ['xUnit', 'NUnit', 'MSTest'].some((name) => frameworks.has(name));
  if (metadata.type === 'dotnet' && dotnetTests) {
    tests.add('dotnet test');
    testCommands.push('dotnet test');
  }

  if (Array.isArray(projectPusherConfig?.testCommands)) {
    for (const command of projectPusherConfig.testCommands) {
      if (typeof command === 'string' && command.trim() && command.length <= 500) testCommands.push(command.trim());
    }
  }

  const securityFindings = scanSecurityRisks(root, files);
  const existingRepoFiles = STANDARD_REPO_FILES.filter((repoFile) => fileSet.has(repoFile));
  const recommendedFiles = STANDARD_REPO_FILES.filter((repoFile) => !fileSet.has(repoFile));
  const description = inferPurpose(metadata, [...frameworks], files);
  const readiness = scoreReadiness({
    securityFindings,
    existingRepoFiles,
    testCommands,
    type: metadata.type,
    description: metadata.description,
    fileSet
  });

  const warnings = securityFindings.map((finding) => finding.message);
  if (!testCommands.length) warnings.push('No runnable test command was detected.');
  if (walk.truncated) warnings.push('Scan limit reached; the summary may be incomplete.');

  return {
    projectName: metadata.projectName,
    description,
    projectType: projectTypeLabel(metadata.type),
    projectTypeId: metadata.type,
    languages,
    frameworks: uniqueSorted(frameworks),
    packageManagers: uniqueSorted(packageManagers),
    tests: uniqueSorted(tests),
    testCommands: uniqueSorted(testCommands),
    repoReadiness: readiness.label,
    readinessScore: readiness.score,
    warnings,
    securityFindings,
    recommendedFiles,
    existingRepoFiles,
    ignoredDirectoriesPresent: walk.ignoredDirectoriesPresent,
    fileCount: files.length,
    scanTruncated: walk.truncated
  };
}

module.exports = {
  IGNORE_DIRS,
  STANDARD_REPO_FILES,
  scanProject,
  walkProject
};
