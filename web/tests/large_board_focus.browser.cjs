/* Regression: opening a detail with Focus and hundreds of finished requests. */
const assert = require('node:assert/strict');
const {spawn, spawnSync} = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

test('a large finished board stays responsive with Focus on', {timeout: 90000}, async () => {
  const env = {...process.env, CD_LARGE_FOCUS_FIXTURE: '1', CHROME_DEVTOOLS_AXI_AUTO_CONNECT: '0', CHROME_DEVTOOLS_AXI_SESSION: `deck-focus-${process.pid}`};
  const server = spawn('python3', ['-B', path.join(__dirname, 'detail_navigation_fixture.py')], {env, stdio: ['ignore', 'pipe', 'pipe']});
  const run = (command, ...args) => {
    const result = spawnSync('chrome-devtools-axi', [command, ...args.map(String)], {env, encoding: 'utf8', timeout: 30000});
    assert.equal(result.status, 0, `${command}: ${result.error || ''} ${result.stdout} ${result.stderr}`);
    return result.stdout;
  };
  const evaluate = code => {
    let value = JSON.parse(run('eval', code).match(/^result: (.*)$/m)[1]);
    while (typeof value === 'string') value = JSON.parse(value);
    return value;
  };
  try {
    const url = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(Error(output || 'fixture did not start')), 10000);
      server.stdout.on('data', chunk => {
        output += chunk;
        const match = output.match(/Fixture at (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      server.stderr.on('data', chunk => { output += chunk; });
      server.once('exit', () => { clearTimeout(timer); reject(Error(output)); });
    });
    run('open', url);
    run('resize', 1970, 1250);
    const before = evaluate(`()=>{
      const animations = document.querySelector('#deck-animations');
      if (animations.checked) animations.click();
      document.querySelector('#state-column-done .col-h button').click();
      [...document.querySelectorAll('#columns-nav button')].find(x=>x.textContent==='Expand requests').click();
      return JSON.stringify({rows:document.querySelectorAll('#state-column-done .request-row').length,focus:document.querySelector('#focus-effects').checked});
    }`);
    assert.equal(before.rows, 481);
    assert.equal(before.focus, true);
    const after = evaluate(`()=>{
      document.querySelector('[data-node="fixture:task:origin"] .card-open').click();
      return JSON.stringify({title:document.querySelector('#detail-title').textContent,focus:document.querySelector('#focus-effects').checked});
    }`);
    assert.equal(after.title, 'Origin task');
    assert.equal(after.focus, true);
  } finally {
    server.kill('SIGTERM');
    spawnSync('chrome-devtools-axi', ['stop'], {env, encoding: 'utf8', timeout: 10000});
    await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve));
  }
});
