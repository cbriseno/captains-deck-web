const assert = require('node:assert/strict');
const {spawn, spawnSync} = require('node:child_process');
const {once} = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('browser sessions stop when opening the page fails', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-cleanup-'));
  try {
    const cli = path.join(dir, 'browser');
    fs.writeFileSync(cli, '#!/bin/sh\necho "$1" >> "$CLEANUP_LOG"\nif [ "$1" = stop ]; then kill "$BROWSER_PID"; exit; fi\nexit 1\n', {mode: 0o700});
    for (const name of ['action_required', 'board_ordering', 'question_cards', 'state_observation', 'anonymize']) {
      const log = path.join(dir, name);
      const browser = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
      const exited = once(browser, 'exit');
      const env = {...process.env, CD_TEST_BROWSER: cli, CLEANUP_LOG: log, BROWSER_PID: String(browser.pid)};
      delete env.NODE_TEST_CONTEXT;
      delete env.CD_TEST_SESSION;
      const result = spawnSync(process.execPath, ['--test', path.join(__dirname, name + '.browser.cjs')], {
        env, encoding: 'utf8', timeout: 30000
      });
      const outcome = await Promise.race([exited, new Promise(resolve => setTimeout(() => resolve(null), 2000))]);
      if (!outcome) browser.kill();
      assert.ok(outcome, 'browser process did not exit');
      assert.equal(outcome[1], 'SIGTERM');
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), ['open', 'stop'], name);
    }
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
