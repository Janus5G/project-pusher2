'use strict';

let currentFolder = null;
let currentScan = null;

const byId = (id) => document.getElementById(id);

function setText(id, value) {
  byId(id).textContent = value || '—';
}

function renderList(elementId, items, emptyText, className = '') {
  const list = byId(elementId);
  list.textContent = '';
  list.className = `scan-list ${className}`.trim();
  const values = Array.isArray(items) && items.length ? items : [emptyText];
  for (const value of values) {
    const li = document.createElement('li');
    li.textContent = value;
    list.appendChild(li);
  }
}

function updateGenerationOptions(scan) {
  const existing = new Set(scan.existingRepoFiles || []);
  const recommended = new Set(scan.recommendedFiles || []);

  document.querySelectorAll('input[data-repo-file]').forEach((checkbox) => {
    const repoFile = checkbox.dataset.repoFile;
    const alreadyExists = existing.has(repoFile);
    checkbox.disabled = alreadyExists;
    checkbox.checked = !alreadyExists && recommended.has(repoFile);
    const state = checkbox.closest('label')?.querySelector('.file-state');
    if (state) state.textContent = alreadyExists ? 'exists' : (recommended.has(repoFile) ? 'recommended' : '');
  });
}

function renderScanSummary(scan) {
  currentScan = scan;
  setText('scanProjectType', scan.projectType);
  setText('scanLanguages', (scan.languages || []).join(', ') || 'None detected');
  setText('scanFrameworks', (scan.frameworks || []).join(', ') || 'None detected');
  setText('scanManagers', (scan.packageManagers || []).join(', ') || 'None detected');
  setText('scanTests', (scan.tests || []).join(', ') || 'No tests detected');
  setText('scanPurpose', scan.description);
  setText('scanStatus', `${scan.projectName} · ${scan.fileCount} scanned file(s) · local scan only`);

  const score = byId('scanScore');
  score.textContent = `${scan.readinessScore}/100 · ${scan.repoReadiness}`;
  score.className = `readiness-badge readiness-${scan.repoReadiness}`;

  renderList('scanWarnings', scan.warnings, 'Ingen advarsler.', scan.warnings?.length ? 'warning' : 'success');
  renderList('scanRecommended', scan.recommendedFiles, 'Ingen manglende standardfiler.', scan.recommendedFiles?.length ? '' : 'success');
  updateGenerationOptions(scan);

  const projectName = byId('projectName');
  if (!projectName.value.trim() || projectName.value === 'My Project') projectName.value = scan.projectName || '';
  const description = byId('description');
  if (!description.value.trim()) description.value = scan.description || '';

  const testOutput = byId('testOutput');
  if (scan.testCommands?.length) {
    testOutput.textContent = `Detected test command(s):\n${scan.testCommands.map((command) => `> ${command}`).join('\n')}`;
  } else {
    testOutput.textContent = 'No runnable test command detected.';
  }
}

async function refreshTree() {
  if (!currentFolder) return;
  const tree = await window.api.getFolderTree(currentFolder);
  renderTree(tree);
}

// ----- Folder, tree and hidden scanner -----
byId('selectFolder').addEventListener('click', async () => {
  try {
    const selected = await window.api.selectFolder();
    if (!selected) return;
    currentFolder = selected;
    currentScan = null;
    byId('folderPath').textContent = currentFolder;
    byId('scanStatus').textContent = 'Scanner projektet lokalt…';
    byId('scanScore').textContent = 'Scanner…';

    const [tree, scan] = await Promise.all([
      window.api.getFolderTree(currentFolder),
      window.api.scanProject(currentFolder)
    ]);
    renderTree(tree);
    renderScanSummary(scan);
  } catch (error) {
    byId('scanStatus').textContent = `Scan failed: ${error.message}`;
    alert(`Fejl ved mappevalg: ${error.message}`);
  }
});

function renderTree(nodes) {
  const container = byId('tree');
  container.textContent = '';

  function addNodes(items, indent = 0) {
    for (const node of items) {
      const div = document.createElement('div');
      div.className = `tree-item ${node.type}`;

      const spacer = document.createElement('span');
      spacer.className = 'tree-indent';
      spacer.style.width = `${indent * 16}px`;
      div.appendChild(spacer);

      const icon = node.type === 'directory' ? '📁' : (node.type === 'symlink' ? '🔗' : (node.type === 'notice' ? '…' : '📄'));
      const label = document.createElement('span');
      label.textContent = `${icon} ${node.name}${node.ignored ? ' (ignored)' : ''}`;
      div.appendChild(label);
      container.appendChild(div);

      if (node.type === 'directory' && node.children?.length) addNodes(node.children, indent + 1);
    }
  }

  addNodes(nodes || []);
}

// ----- Tests -----
byId('runTests').addEventListener('click', async () => {
  if (!currentFolder) return alert('Vælg en mappe først');
  const outputEl = byId('testOutput');
  outputEl.textContent = 'Kører tests...';
  try {
    const commands = currentScan?.testCommands || [];
    const result = await window.api.runTests(currentFolder, commands);
    outputEl.textContent = result;
  } catch (error) {
    outputEl.textContent = `Testfejl: ${error.message}`;
  }
});

// ----- Generate files -----
byId('generate').addEventListener('click', async () => {
  if (!currentFolder) return alert('Vælg en mappe først');

  const options = {
    projectName: byId('projectName').value,
    description: byId('description').value,
    author: byId('author').value,
    year: byId('year').value,
    license: byId('licenseType').value,
    files: {
      gitignore: byId('gitignore').checked,
      readme: byId('readme').checked,
      security: byId('security').checked,
      contributing: byId('contributing').checked,
      codeOfConduct: byId('codeOfConduct').checked,
      editorconfig: byId('editorconfig').checked,
      ci: byId('ci').checked,
      repodoc: byId('repodoc').checked,
      dependabot: byId('dependabot').checked,
      bugTemplate: byId('bugTemplate').checked,
      featureTemplate: byId('featureTemplate').checked,
      gitleaks: byId('gitleaks').checked,
      envExample: byId('envExample').checked,
      changelog: byId('changelog').checked,
      license: byId('license').checked
    }
  };

  try {
    const result = await window.api.generateFiles(currentFolder, options);
    renderScanSummary(result.scan);
    await refreshTree();
    alert(`${result.created.length} fil(er) oprettet. ${result.skippedExisting.length} eksisterende fil(er) blev ikke ændret.`);
  } catch (error) {
    alert(`Genereringsfejl: ${error.message}`);
  }
});

// ----- GitHub login: main-process memory only -----
byId('login').addEventListener('click', async () => {
  const status = byId('tokenStatus');
  status.textContent = 'Venter på GitHub…';
  status.classList.remove('error');
  try {
    const auth = await window.api.startOAuth();
    status.textContent = auth.authenticated ? `Logget ind som ${auth.login} ✅` : 'Ikke logget ind';
  } catch (error) {
    status.textContent = `Loginfejl: ${error.message}`;
    status.classList.add('error');
  }
});

// ----- Push -----
byId('push').addEventListener('click', async () => {
  if (!currentFolder) return alert('Vælg en mappe først');
  const remoteUrl = byId('remoteUrl').value;
  const branch = byId('branch').value;
  try {
    await window.api.pushToRemote(currentFolder, remoteUrl, branch);
    alert('Push gennemført!');
  } catch (error) {
    alert(`Fejl: ${error.message}`);
  }
});
