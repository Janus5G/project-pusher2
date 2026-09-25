'use strict';

const fs = require('fs');
const path = require('path');
const simpleGit = require('simple-git');
const { normalizeGitHubHttpsUrl, assertMatchingOrigin } = require('./security-checks');

async function currentOrigin(git) {
  const remotes = await git.getRemotes(true);
  const origin = remotes.find((remote) => remote.name === 'origin');
  return origin?.refs?.push || origin?.refs?.fetch || '';
}

async function hasHeadCommit(git) {
  try {
    await git.revparse(['--verify', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

async function pushToGitHub(folderPath, remoteUrl, branch, token) {
  const root = fs.realpathSync(path.resolve(folderPath));
  const requestedRemote = normalizeGitHubHttpsUrl(remoteUrl);
  if (typeof token !== 'string' || !token.trim()) throw new Error('GitHub authentication is required before pushing.');
  if (typeof branch !== 'string' || !branch.trim()) throw new Error('A branch name is required.');

  const git = simpleGit({ baseDir: root, binary: 'git', maxConcurrentProcesses: 1 });
  let isRepo = await git.checkIsRepo();
  if (!isRepo) {
    await git.init();
    isRepo = true;
  }

  await git.raw(['check-ref-format', '--branch', branch.trim()]);

  const origin = await currentOrigin(git);
  assertMatchingOrigin(origin, requestedRemote);
  if (!origin) await git.addRemote('origin', requestedRemote);

  await git.add(['-A']);
  const status = await git.status();
  const hasHead = await hasHeadCommit(git);
  if (!status.isClean()) {
    await git.commit(hasHead ? 'Update via Project Pusher' : 'Initial commit via Project Pusher');
  } else if (!hasHead) {
    throw new Error('There are no files to commit.');
  }

  const basicAuth = Buffer.from(`x-access-token:${token.trim()}`, 'utf8').toString('base64');
  const authenticatedGit = simpleGit({ baseDir: root, binary: 'git', maxConcurrentProcesses: 1 }).env({
    ...process.env,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.extraHeader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basicAuth}`
  });

  await authenticatedGit.raw(['push', '--set-upstream', 'origin', `HEAD:${branch.trim()}`]);
  return { message: 'Push successful', remote: requestedRemote, branch: branch.trim() };
}

module.exports = { pushToGitHub };
