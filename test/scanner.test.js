'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanProject } = require('../main/scanner');

function makeTempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'project-pusher-scan-'));
}

test('scanner detects Node metadata, frameworks, tests and security warnings', async (t) => {
  const root = makeTempProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'fixture-app',
    description: 'Fixture application',
    scripts: { test: 'jest' },
    dependencies: { react: '^19.0.0' },
    devDependencies: { vite: '^7.0.0', jest: '^30.0.0', '@playwright/test': '^1.0.0' }
  }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'index.js'), 'export const answer = 42;\n');
  fs.writeFileSync(path.join(root, '.env'), 'EXAMPLE_ONLY=value\n');
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'node_modules', 'ignored.js'), 'ignored\n');

  const scan = await scanProject(root);

  assert.equal(scan.projectName, 'fixture-app');
  assert.equal(scan.projectType, 'Node');
  assert.ok(scan.languages.includes('JavaScript'));
  assert.ok(scan.frameworks.includes('React'));
  assert.ok(scan.frameworks.includes('Vite'));
  assert.ok(scan.frameworks.includes('Jest'));
  assert.ok(scan.frameworks.includes('Playwright'));
  assert.deepEqual(scan.packageManagers, ['npm']);
  assert.ok(scan.tests.includes('npm test'));
  assert.deepEqual(scan.testCommands, ['npm test']);
  assert.ok(scan.warnings.some((warning) => warning.includes('.env')));
  assert.ok(scan.ignoredDirectoriesPresent.includes('node_modules'));
  assert.equal(scan.securityFindings[0].severity, 'high');
});

test('scanner recognizes Python, Go, Rust, Java, .NET and generic projects', async (t) => {
  const cases = [
    {
      expected: 'Python',
      files: { 'requirements.txt': 'fastapi\npytest\n', 'app.py': 'print("ok")\n', 'test_app.py': 'def test_ok():\n    assert True\n' }
    },
    {
      expected: 'Go',
      files: { 'go.mod': 'module example.test/demo\ngo 1.23\n', 'main.go': 'package main\n', 'main_test.go': 'package main\n' }
    },
    {
      expected: 'Rust',
      files: { 'Cargo.toml': '[package]\nname="demo"\nversion="0.1.0"\n', 'src/lib.rs': '#[test]\nfn it_works() {}\n' }
    },
    {
      expected: 'Java',
      files: { 'pom.xml': '<project><artifactId>demo</artifactId><dependency><artifactId>junit-jupiter</artifactId></dependency></project>', 'src/main/java/App.java': 'class App {}\n', 'src/test/java/AppTest.java': 'class AppTest {}\n' }
    },
    {
      expected: '.NET',
      files: { 'Demo.csproj': '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="xunit" Version="2.0" /></ItemGroup></Project>', 'Program.cs': 'class Program {}\n', 'Demo.Tests.csproj': '<Project Sdk="Microsoft.NET.Sdk" />\n' }
    },
    {
      expected: 'Generic',
      files: { 'notes.txt': 'generic\n' }
    }
  ];

  for (const fixture of cases) {
    await t.test(fixture.expected, async () => {
      const root = makeTempProject();
      try {
        for (const [relative, content] of Object.entries(fixture.files)) {
          const destination = path.join(root, relative);
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          fs.writeFileSync(destination, content);
        }
        const scan = await scanProject(root);
        assert.equal(scan.projectType, fixture.expected);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
});


test('scanner detects a safe Electron release profile', async (t) => {
  const root = makeTempProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'release-fixture',
    version: '1.2.3',
    scripts: {
      test: 'node --test',
      'build:win': 'electron-builder --win nsis --x64 --publish never',
      'build:linux': 'electron-builder --linux AppImage --x64 --publish never',
      'build:mac': 'electron-builder --mac dmg zip --universal --publish never'
    },
    devDependencies: {
      electron: '^43.0.0',
      'electron-builder': '^26.0.0'
    }
  }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');

  const scan = await scanProject(root);

  assert.equal(scan.releaseAutomation.supported, true);
  assert.equal(scan.releaseAutomation.profile, 'electron-builder');
  assert.equal(scan.releaseAutomation.installCommand, 'npm ci');
  assert.equal(scan.releaseAutomation.version, '1.2.3');
  assert.equal(scan.releaseAutomation.buildCommands.windows, 'npm run build:win');
  assert.ok(scan.recommendedFiles.includes('.github/workflows/release.yml'));
});


test('scanner refuses ambiguous Electron release scripts', async (t) => {
  const root = makeTempProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'ambiguous-release',
    version: '1.0.0',
    scripts: {
      'build:win': 'electron-builder --win portable'
    },
    devDependencies: {
      electron: '^43.0.0',
      'electron-builder': '^26.0.0'
    }
  }));

  const scan = await scanProject(root);

  assert.equal(scan.releaseAutomation.supported, false);
  assert.match(scan.releaseAutomation.reason, /will not replace or guess/i);
  assert.ok(!scan.recommendedFiles.includes('.github/workflows/release.yml'));
});
