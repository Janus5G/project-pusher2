'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeGitHubHttpsUrl,
  assertMatchingOrigin,
  classifySensitivePath
} = require('../main/security-checks');

test('GitHub remote validation accepts only canonical GitHub HTTPS repository URLs', () => {
  assert.equal(
    normalizeGitHubHttpsUrl('https://github.com/Janus5G/Project-Pusher'),
    'https://github.com/Janus5G/Project-Pusher.git'
  );
  assert.throws(() => normalizeGitHubHttpsUrl('git@github.com:Janus5G/Project-Pusher.git'));
  assert.throws(() => normalizeGitHubHttpsUrl('https://example.com/Janus5G/Project-Pusher.git'));
  assert.throws(() => normalizeGitHubHttpsUrl('https://user:token@github.com/Janus5G/Project-Pusher.git'));
});

test('existing origin is never silently replaced with a different repository', () => {
  assert.equal(
    assertMatchingOrigin(
      'https://github.com/Janus5G/Project-Pusher.git',
      'https://github.com/janus5g/project-pusher'
    ),
    'https://github.com/janus5g/project-pusher.git'
  );
  assert.throws(
    () => assertMatchingOrigin(
      'https://github.com/Janus5G/Other.git',
      'https://github.com/Janus5G/Project-Pusher.git'
    ),
    /different repository/
  );
});

test('sensitive filenames are flagged without requiring secret values', () => {
  assert.equal(classifySensitivePath('.env').severity, 'high');
  assert.equal(classifySensitivePath('keys/server.key').severity, 'high');
  assert.equal(classifySensitivePath('.env.example'), null);
});
