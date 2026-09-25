'use strict';

const { exec } = require('child_process');

function runCommand(folderPath, command, options = {}) {
  return new Promise((resolve) => {
    const timeout = options.timeout || 10 * 60 * 1000;
    exec(command, {
      cwd: folderPath,
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env }
    }, (error, stdout, stderr) => {
      resolve({
        command,
        exitCode: typeof error?.code === 'number' ? error.code : (error ? 1 : 0),
        stdout: stdout || '',
        stderr: stderr || '',
        timedOut: Boolean(error?.killed && error?.signal)
      });
    });
  });
}

async function runTestCommands(folderPath, commands) {
  if (!Array.isArray(commands) || commands.length === 0) {
    return 'No test command was detected for this project.\n';
  }
  if (commands.length > 20 || commands.some((command) => typeof command !== 'string' || !command.trim() || command.length > 500)) {
    throw new Error('Invalid test command list.');
  }

  let output = '';
  for (const command of commands) {
    const result = await runCommand(folderPath, command.trim());
    output += `> ${result.command}\n${result.stdout}${result.stderr}`;
    if (result.timedOut) output += '\n[Project Pusher] Command timed out.\n';
    output += `\n[exit ${result.exitCode}]\n\n`;
  }
  return output;
}

module.exports = { runCommand, runTestCommands };
