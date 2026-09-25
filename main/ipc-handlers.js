'use strict';

const fs = require('fs');
const path = require('path');
const { IGNORE_DIRS, scanProject } = require('./scanner');
const { generateRepoFiles } = require('./repo-generator');
const { runTestCommands } = require('./test-runner');
const { startGitHubDeviceFlow, validateGitHubToken } = require('./auth');
const { pushToGitHub } = require('./git-push');

async function buildFolderTree(root, options = {}) {
  const maxNodes = options.maxNodes || 5000;
  let nodeCount = 0;

  async function walk(directory) {
    let entries;
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    const nodes = [];
    for (const entry of entries) {
      if (nodeCount >= maxNodes) break;
      nodeCount += 1;
      const fullPath = path.join(directory, entry.name);

      if (entry.isSymbolicLink()) {
        nodes.push({ name: entry.name, type: 'symlink' });
      } else if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) {
          nodes.push({ name: entry.name, type: 'directory', ignored: true, children: [] });
        } else {
          nodes.push({ name: entry.name, type: 'directory', children: await walk(fullPath) });
        }
      } else if (entry.isFile()) {
        nodes.push({ name: entry.name, type: 'file' });
      }
    }
    return nodes;
  }

  const tree = await walk(root);
  if (nodeCount >= maxNodes) tree.push({ name: '… tree view truncated …', type: 'notice' });
  return tree;
}

function registerIpcHandlers({ ipcMain, dialog }) {
  let selectedFolder = null;
  let scanPromise = null;
  let githubSession = null;

  const assertSelectedFolder = (folderPath) => {
    if (!selectedFolder) throw new Error('Select a project folder first.');
    if (typeof folderPath !== 'string' || !folderPath.trim()) throw new Error('Project folder is missing.');
    const resolved = fs.realpathSync(path.resolve(folderPath));
    if (resolved !== selectedFolder) throw new Error('The requested path is not the currently selected project folder.');
    return resolved;
  };

  const startScan = (folderPath) => {
    scanPromise = scanProject(folderPath).catch((error) => {
      scanPromise = null;
      throw error;
    });
    return scanPromise;
  };

  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    selectedFolder = await fs.promises.realpath(path.resolve(result.filePaths[0]));
    startScan(selectedFolder); // Hidden scan begins immediately; existing return type stays unchanged.
    return selectedFolder;
  });

  ipcMain.handle('get-folder-tree', async (_event, folderPath) => {
    const root = assertSelectedFolder(folderPath);
    return buildFolderTree(root);
  });

  ipcMain.handle('scan-project', async (_event, folderPath) => {
    const root = assertSelectedFolder(folderPath);
    if (!scanPromise) startScan(root);
    return scanPromise;
  });

  ipcMain.handle('run-tests', async (_event, folderPath, commands) => {
    const root = assertSelectedFolder(folderPath);
    const scan = await (scanPromise || startScan(root));
    const requested = Array.isArray(commands) && commands.length ? commands : scan.testCommands;
    return runTestCommands(root, requested);
  });

  ipcMain.handle('generate-files', async (_event, folderPath, options) => {
    const root = assertSelectedFolder(folderPath);
    const scan = await (scanPromise || startScan(root));
    const generation = generateRepoFiles(root, scan, options || {});
    const refreshedScan = await startScan(root);
    return { ...generation, scan: refreshedScan };
  });

  ipcMain.handle('start-oauth', async () => {
    const auth = await startGitHubDeviceFlow();
    githubSession = { token: auth.token, login: auth.login };
    return { authenticated: true, login: auth.login };
  });

  ipcMain.handle('push-to-remote', async (_event, folderPath, remoteUrl, branch) => {
    const root = assertSelectedFolder(folderPath);
    if (!githubSession?.token) throw new Error('Log in to GitHub first.');
    const validation = await validateGitHubToken(githubSession.token);
    githubSession.login = validation.login;
    return pushToGitHub(root, remoteUrl, branch, githubSession.token);
  });

  return {
    clearSession() {
      githubSession = null;
      scanPromise = null;
      selectedFolder = null;
    }
  };
}

module.exports = { registerIpcHandlers, buildFolderTree };
