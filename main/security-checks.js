'use strict';

const fs = require('fs');
const path = require('path');

const SAFE_ENV_FILES = new Set(['.env.example', '.env.sample', '.env.template']);
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.jsonc', '.js', '.cjs', '.mjs', '.jsx', '.ts', '.tsx',
  '.py', '.toml', '.yaml', '.yml', '.ini', '.cfg', '.conf', '.xml', '.properties',
  '.env', '.sh', '.bash', '.zsh', '.ps1', '.cs', '.java', '.go', '.rs', '.rb', '.php'
]);

const SECRET_CONTENT_PATTERNS = [
  { label: 'Private key material', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: 'GitHub token-like value', regex: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/ },
  { label: 'AWS access key-like value', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'OpenAI token-like value', regex: /\bsk-[A-Za-z0-9_-]{20,}\b/ }
];

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function classifySensitivePath(relativePath) {
  const normalized = toPosix(relativePath);
  const base = path.posix.basename(normalized);
  const lower = base.toLowerCase();
  const ext = path.posix.extname(lower);

  if (lower.startsWith('.env') && !SAFE_ENV_FILES.has(lower)) {
    return { severity: 'high', kind: 'environment-file', message: `${normalized}: environment file may contain secrets.` };
  }

  if (['.pem', '.key', '.p12', '.pfx', '.jks'].includes(ext) || ['id_rsa', 'id_ed25519'].includes(lower)) {
    return { severity: 'high', kind: 'private-key-file', message: `${normalized}: private key or certificate container should not be committed.` };
  }

  if (ext === '.crt' || ext === '.cer') {
    return { severity: 'medium', kind: 'certificate-file', message: `${normalized}: certificate file detected; verify that it is intended to be public.` };
  }

  if (['.npmrc', '.pypirc'].includes(lower)) {
    return { severity: 'medium', kind: 'credential-config', message: `${normalized}: package-manager config can contain authentication tokens.` };
  }

  if (/^(credentials?|secrets?|tokens?)(\.|$)/i.test(base) || /(^|[._-])(credentials?|secrets?|tokens?)([._-]|$)/i.test(base)) {
    return { severity: 'high', kind: 'credential-file', message: `${normalized}: filename suggests credentials, tokens, or secrets.` };
  }

  if (/^(config|settings)\.local\./i.test(base) || /\.local\.json$/i.test(base) || lower === 'local.settings.json') {
    return { severity: 'medium', kind: 'local-config', message: `${normalized}: local configuration may contain machine-specific or secret values.` };
  }

  return null;
}

function isProbablyTextFile(relativePath, size) {
  if (size > 512 * 1024) return false;
  const base = path.basename(relativePath).toLowerCase();
  if (base.startsWith('.env')) return true;
  if (['dockerfile', 'makefile', '.npmrc', '.pypirc'].includes(base)) return true;
  return TEXT_EXTENSIONS.has(path.extname(base));
}

function scanSecurityRisks(root, fileEntries, options = {}) {
  const maxContentFiles = options.maxContentFiles || 1500;
  const findings = [];
  const seen = new Set();
  let contentFilesRead = 0;

  const addFinding = (finding) => {
    const key = `${finding.kind}:${finding.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push(finding);
    }
  };

  for (const entry of fileEntries) {
    const relativePath = typeof entry === 'string' ? entry : entry.path;
    const size = typeof entry === 'string' ? 0 : entry.size;
    const pathFinding = classifySensitivePath(relativePath);
    if (pathFinding) addFinding(pathFinding);

    if (contentFilesRead >= maxContentFiles || !isProbablyTextFile(relativePath, size)) continue;

    const fullPath = path.join(root, relativePath);
    let text;
    try {
      text = fs.readFileSync(fullPath, 'utf8');
      contentFilesRead += 1;
    } catch {
      continue;
    }

    for (const pattern of SECRET_CONTENT_PATTERNS) {
      if (pattern.regex.test(text)) {
        addFinding({
          severity: 'high',
          kind: 'secret-content',
          message: `${toPosix(relativePath)}: ${pattern.label} detected. The value is intentionally not displayed.`
        });
      }
    }
  }

  return findings.sort((a, b) => {
    const weight = { high: 0, medium: 1, low: 2 };
    return (weight[a.severity] - weight[b.severity]) || a.message.localeCompare(b.message);
  });
}

function normalizeGitHubHttpsUrl(remoteUrl) {
  if (typeof remoteUrl !== 'string' || !remoteUrl.trim()) {
    throw new Error('A GitHub HTTPS repository URL is required.');
  }

  let parsed;
  try {
    parsed = new URL(remoteUrl.trim());
  } catch {
    throw new Error('The remote URL is not a valid URL.');
  }

  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com') {
    throw new Error('Only GitHub HTTPS remotes are allowed (https://github.com/owner/repository.git).');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.port) {
    throw new Error('The GitHub remote must not contain credentials, query parameters, fragments, or a custom port.');
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length !== 2) {
    throw new Error('The GitHub remote must identify exactly one owner and repository.');
  }

  const owner = segments[0];
  const repository = segments[1].replace(/\.git$/i, '');
  const safePart = /^[A-Za-z0-9_.-]+$/;
  if (!owner || !repository || !safePart.test(owner) || !safePart.test(repository)) {
    throw new Error('The GitHub owner or repository name contains unsupported characters.');
  }

  return `https://github.com/${owner}/${repository}.git`;
}

function assertMatchingOrigin(existingOrigin, requestedRemote) {
  const requested = normalizeGitHubHttpsUrl(requestedRemote);
  if (!existingOrigin) return requested;

  const existing = normalizeGitHubHttpsUrl(existingOrigin);
  if (existing.toLowerCase() !== requested.toLowerCase()) {
    throw new Error(`Existing origin points to a different repository: ${existing}. Project Pusher will not replace it.`);
  }
  return requested;
}

function isSensitiveGenerationTarget(relativePath) {
  const normalized = toPosix(relativePath);
  const base = path.posix.basename(normalized).toLowerCase();
  if (SAFE_ENV_FILES.has(base)) return false;
  return Boolean(classifySensitivePath(normalized));
}

module.exports = {
  SAFE_ENV_FILES,
  classifySensitivePath,
  scanSecurityRisks,
  normalizeGitHubHttpsUrl,
  assertMatchingOrigin,
  isSensitiveGenerationTarget
};
