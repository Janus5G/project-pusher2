'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateRepoFiles } = require('../main/repo-generator');

function makeScan() {
  return {
    projectName: 'fixture',
    description: 'Fixture project',
    projectType: 'Node',
    projectTypeId: 'node',
    languages: ['JavaScript'],
    frameworks: ['Vite'],
    packageManagers: ['npm'],
    testCommands: ['npm test']
  };
}

test('repo generator creates only missing files and never overwrites existing files', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-pusher-gen-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.writeFileSync(path.join(root, 'README.md'), 'KEEP THIS CONTENT\n');
  const result = generateRepoFiles(root, makeScan(), {
    projectName: 'fixture',
    description: 'Fixture project',
    files: { readme: true, gitignore: true, security: true, ci: true }
  });

  assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), 'KEEP THIS CONTENT\n');
  assert.ok(fs.existsSync(path.join(root, '.gitignore')));
  assert.ok(fs.existsSync(path.join(root, 'SECURITY.md')));
  assert.ok(fs.existsSync(path.join(root, '.github', 'workflows', 'ci.yml')));
  assert.ok(result.skippedExisting.includes('README.md'));
  assert.ok(result.created.includes('.gitignore'));
});


test('license generation preserves MIT, Apache-2.0 and GPL-3.0 options', (t) => {
  const cases = [
    ['MIT', 'MIT License'],
    ['Apache-2.0', 'Apache License'],
    ['GPL-3.0', 'GNU GENERAL PUBLIC LICENSE']
  ];

  for (const [license, expected] of cases) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-pusher-license-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const result = generateRepoFiles(root, makeScan(), {
      author: 'Example Author', year: '2026', license, files: { license: true }
    });
    assert.deepEqual(result.created, ['LICENSE']);
    const content = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
    assert.match(content, new RegExp(expected));
    assert.doesNotMatch(content, /^\.\.\.$/m);
  }
});
