'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('renderer HTML contains every scan and generation control used by renderer.js', () => {
  const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
  const requiredIds = [
    'selectFolder', 'folderPath', 'tree', 'scanScore', 'scanStatus', 'scanProjectType',
    'scanLanguages', 'scanFrameworks', 'scanManagers', 'scanTests', 'scanPurpose', 'scanRelease',
    'scanWarnings', 'scanRecommended', 'runTests', 'testOutput', 'generate',
    'gitignore', 'readme', 'security', 'contributing', 'codeOfConduct', 'editorconfig',
    'ci', 'release', 'repodoc', 'dependabot', 'bugTemplate', 'featureTemplate', 'gitleaks',
    'envExample', 'changelog', 'license', 'licenseType', 'projectName', 'description',
    'author', 'year', 'login', 'tokenStatus', 'remoteUrl', 'branch', 'push'
  ];
  for (const id of requiredIds) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
});

test('preload exposes the scanner without exposing arbitrary ipcRenderer access', () => {
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'renderer', 'renderer.js'), 'utf8');
  assert.match(preload, /scanProject:\s*\(folder\)/);
  assert.doesNotMatch(preload, /exposeInMainWorld\([^)]*ipcRenderer/);
  assert.doesNotMatch(renderer, /localStorage|sessionStorage/);
});
