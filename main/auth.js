'use strict';

const https = require('https');
const { URLSearchParams } = require('url');
const { shell, dialog } = require('electron');

function requestJson({ hostname, path, method = 'GET', headers = {}, body = '' }) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname,
      path,
      method,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Project-Pusher',
        ...headers
      }
    }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        let parsed = {};
        try { parsed = data ? JSON.parse(data) : {}; } catch { /* handled below */ }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const message = parsed.message || `GitHub request failed with HTTP ${response.statusCode}.`;
          return reject(new Error(message));
        }
        resolve(parsed);
      });
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function validateGitHubToken(token) {
  if (typeof token !== 'string' || !token.trim()) throw new Error('GitHub token is missing.');
  const user = await requestJson({
    hostname: 'api.github.com',
    path: '/user',
    headers: { Authorization: `Bearer ${token.trim()}`, 'X-GitHub-Api-Version': '2022-11-28' }
  });
  return { valid: true, login: user.login || 'GitHub user' };
}

async function startGitHubDeviceFlow() {
  const clientId = process.env.PROJECT_PUSHER_GITHUB_CLIENT_ID;
  if (!clientId) {
    throw new Error('GitHub login is not configured. Set PROJECT_PUSHER_GITHUB_CLIENT_ID to a GitHub OAuth App client ID with Device Flow enabled.');
  }

  const startBody = new URLSearchParams({ client_id: clientId, scope: 'repo' }).toString();
  const device = await requestJson({
    hostname: 'github.com',
    path: '/login/device/code',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(startBody) },
    body: startBody
  });

  if (!device.device_code || !device.user_code || !device.verification_uri) {
    throw new Error('GitHub Device Flow returned an incomplete response.');
  }

  await shell.openExternal(device.verification_uri);
  await dialog.showMessageBox({
    type: 'info',
    title: 'GitHub login',
    message: `Enter this code on GitHub: ${device.user_code}`,
    detail: `Your browser has been opened to ${device.verification_uri}. Project Pusher keeps the resulting token in memory only for this app session.`,
    buttons: ['Continue']
  });

  const startedAt = Date.now();
  const expiresMs = Number(device.expires_in || 900) * 1000;
  let intervalMs = Number(device.interval || 5) * 1000;

  while (Date.now() - startedAt < expiresMs) {
    await sleep(intervalMs);
    const pollBody = new URLSearchParams({
      client_id: clientId,
      device_code: device.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    }).toString();

    const result = await requestJson({
      hostname: 'github.com',
      path: '/login/oauth/access_token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(pollBody) },
      body: pollBody
    });

    if (result.access_token) {
      const validation = await validateGitHubToken(result.access_token);
      return { token: result.access_token, login: validation.login };
    }
    if (result.error === 'authorization_pending') continue;
    if (result.error === 'slow_down') { intervalMs += 5000; continue; }
    if (result.error === 'access_denied') throw new Error('GitHub login was denied.');
    if (result.error === 'expired_token') throw new Error('GitHub login code expired.');
    if (result.error) throw new Error(result.error_description || result.error);
  }

  throw new Error('GitHub login timed out.');
}

module.exports = { startGitHubDeviceFlow, validateGitHubToken };
