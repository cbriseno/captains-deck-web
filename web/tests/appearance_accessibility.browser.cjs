/* Localized accessible naming for the appearance mode group. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const test = require('node:test');

const cli = process.env.CD_TEST_BROWSER || 'chrome-devtools-axi';
const fixture = path.join(__dirname, 'approved_fixture.py');
const available = spawnSync(cli, ['--version'], {encoding: 'utf8'}).status === 0;

test('appearance mode group has localized accessible names and an English fallback', {skip: !available, timeout: 120000}, async () => {
  const proof = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-appearance-a11y-'));
  const session = process.env.CD_TEST_SESSION || `deck-appearance-${process.pid}`;
  const env = {...process.env, CHROME_DEVTOOLS_AXI_AUTO_CONNECT: '0', CHROME_DEVTOOLS_AXI_SESSION: session};
  const children = new Set();
  let browserStarted = false;
  const run = (command, args = []) => {
    const result = spawnSync(cli, [command, ...args], {env, encoding: 'utf8', timeout: command === 'open' ? 60000 : 30000, maxBuffer: 2 * 1024 * 1024});
    assert.equal(result.status, 0, `${command}: ${result.stdout}\n${result.stderr}`);
    return result.stdout;
  };
  const evaluate = code => {
    const output = run('eval', [`async () => JSON.stringify(await (${code})())`]);
    const match = output.match(/^result: (.*)$/m);
    assert.ok(match, output);
    let value = JSON.parse(match[1]);
    for (let i = 0; i < 4 && typeof value === 'string'; i++) { try { value = JSON.parse(value); } catch { break; } }
    return value;
  };
  const startFixture = language => new Promise((resolve, reject) => {
    const dir = path.join(proof, language);
    fs.mkdirSync(dir);
    const child = spawn('python3', [fixture, dir], {env: {...env, CD_WEB_LANGUAGE: language}, stdio: ['ignore', 'pipe', 'pipe']});
    children.add(child);
    let output = '';
    const timer = setTimeout(() => reject(new Error(`fixture startup timeout: ${output}`)), 15000);
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/Fixture at (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timer); resolve({child, url: match[1]}); }
    });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('exit', code => { clearTimeout(timer); children.delete(child); reject(new Error(`fixture exited ${code}: ${output}`)); });
  });
  const stopFixture = child => new Promise(resolve => {
    if (child.exitCode !== null) { children.delete(child); resolve(); return; }
    child.once('exit', () => { children.delete(child); resolve(); });
    child.kill('SIGTERM');
  });

  try {
    const englishServer = await startFixture('en');
    run('open', [englishServer.url]);
    browserStarted = true;
    const english = evaluate(`async()=>{const data=await fetch('api/locale').then(r=>r.json());const group=document.querySelector('#appearance');return {locale:data.locale,catalogName:data.messages['Appearance mode'],role:group.getAttribute('role'),name:group.getAttribute('aria-label')};}`);
    assert.deepEqual(english, {locale: 'en', catalogName: 'Appearance mode', role: 'group', name: 'Appearance mode'});
    const fallback = evaluate(`async()=>{const original=window.fetch;try{window.fetch=async()=>{throw new Error('offline')};await DeckI18n.load();const group=document.querySelector('#appearance');return {locale:document.documentElement.lang,name:group.getAttribute('aria-label')};}finally{window.fetch=original}}`);
    assert.deepEqual(fallback, {locale: 'en', name: 'Appearance mode'});
    await stopFixture(englishServer.child);

    const spanishServer = await startFixture('es-MX');
    run('open', [spanishServer.url]);
    const spanish = evaluate(`async()=>{const wait=async f=>{for(let i=0;i<100;i++){if(f())return;await new Promise(r=>setTimeout(r,50));}throw new Error('locale load timed out');};await wait(()=>document.documentElement.lang==='es-MX');const data=await fetch('api/locale').then(r=>r.json());const group=document.querySelector('#appearance');return {locale:data.locale,catalogName:data.messages['Appearance mode'],role:group.getAttribute('role'),name:group.getAttribute('aria-label')};}`);
    assert.deepEqual(spanish, {locale: 'es-MX', catalogName: 'Modo de apariencia', role: 'group', name: 'Modo de apariencia'});
    await stopFixture(spanishServer.child);
  } finally {
    if (browserStarted) { try { run('stop'); } catch {} }
    await Promise.all([...children].map(stopFixture));
    fs.rmSync(proof, {recursive: true, force: true});
  }
});
