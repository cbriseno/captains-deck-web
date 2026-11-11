/* The shared browser fixture must publish a usable Deck snapshot. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const test = require('node:test');

test('approved fixture publishes task nodes and requests', {timeout:20000}, async () => {
  const proof = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-approved-fixture-'));
  const env = {...process.env, CD_TEST_RELATIONS:'1',
    FM_DIAGNOSTICS_HOME:path.join(proof, 'diagnostics')};
  const child = spawn('python3', [path.join(__dirname, 'approved_fixture.py'), proof],
    {env, stdio:['ignore', 'pipe', 'pipe']});
  try {
    const url = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Fixture startup: ' + output)), 10000);
      child.stdout.on('data', chunk => {
        output += chunk;
        const match = output.match(/Fixture at (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      child.stderr.on('data', chunk => { output += chunk; });
      child.once('exit', code => { clearTimeout(timer); reject(new Error('Fixture exit ' + code + ': ' + output)); });
    });
    let body;
    for (let i = 0; i < 100; i++) {
      const response = await fetch(url + '/api/board');
      body = await response.json();
      if (!body.loading) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(body.loading, false, 'fixture projection should finish its bootstrap');
    const snapshot = body.deck.sources[0]?.snapshot;
    assert.ok(snapshot?.nodes.some(node => node.kind === 'task'), 'fixture should render task nodes');
    assert.ok(snapshot?.requests.length, 'fixture should render request rows');
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve));
    fs.rmSync(proof, {recursive:true, force:true});
  }
});
