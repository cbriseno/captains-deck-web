/* Render synthetic decision tickets in the retained question DOM. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const harnessFile = path.join(__dirname, 'native_details.test.cjs');
const harness = {exports: {}};
vm.runInThisContext('(function (require, __dirname, module) {' + fs.readFileSync(harnessFile, 'utf8') +
  '\n;module.exports = {questionView, descendants};\n})', {filename: harnessFile})(
  (name) => name === 'node:test' ? () => {} : require(name), __dirname, harness);
const {questionView, descendants} = harness.exports;

(async () => {
  const {tickets, expected} = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const messages = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', 'es.json'), 'utf8'));
  for (const [key, ticket] of Object.entries(tickets)) {
    const want = expected[key];
    const served = {[key]: ticket};
    const view = await questionView(served, messages); await view.open(key);
    const nodes = descendants(view.doc.getElementById('detail-content'));
    const list = nodes.find(n => n.className === 'option-list');
    assert.ok(list, key + ': the authored options render as a choice list');
    const choices = descendants(list).filter(n => n.tagName === 'BUTTON');
    assert.deepEqual(choices.map(b => b.dataset.value), want.values, key);
    assert.deepEqual(choices.map(b => b.querySelector('strong').textContent), want.labels, key);
    const marked = choices.filter(b => b.className.includes('recommended-choice'));
    assert.deepEqual(marked.map(b => b.dataset.value), [want.recommend], key + ': only the recommended choice is marked');
    assert.equal(marked[0].querySelector('.recommended').textContent, 'Recomendada', key);
    const recheck = nodes.find(n => n.tagName === 'BUTTON' && n.dataset.value === 'reconcile');
    assert.ok(recheck, key + ': check again first stays available');
    assert.equal(recheck.querySelector('strong').textContent, 'Revisar otra vez primero', key);
    assert.equal(recheck.querySelector('small').textContent, 'Aún no decides nada.', key);
    assert.ok(nodes.some(n => n.tagName === 'DETAILS' && n.className.includes('own-words-fold')), key + ': own words stay available');
    assert.ok(view.requests.every(r => r.method === 'GET'), key + ': opening sends nothing');
    // One click on the recommended choice sends exactly that option.
    served[key + '/answer'] = {saved: true, state: 'saved', message: 'Answer saved by Firstmate.', notice: 'unknown', ack: 'unknown', consumed: 'unknown'};
    marked[0].listeners.click[0](); await view.finishAnswer();
    const posts = view.requests.filter(r => r.method === 'POST');
    assert.equal(posts.length, 1, key); assert.equal(posts[0].body.value, want.recommend, key);
    assert.equal(posts[0].body.occurrence, ticket.call.occurrence, key);
  }
  console.log('private decision cards render as one-click choices: ' + Object.keys(tickets).length);
})().catch((err) => { console.error(err); process.exit(1); });
