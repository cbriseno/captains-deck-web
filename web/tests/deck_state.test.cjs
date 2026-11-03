const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const context = {window: {}};
vm.runInNewContext(fs.readFileSync(require.resolve('../static/deck-state.js'), 'utf8'), context);
const state = context.window.DeckState;
const keyOf = (home, id) => home + ':' + id;

test('task card project identity repairs a missing snapshot parent', () => {
  const rows = [{kind:'task',home:'fixture',parent:'',card:{project:{id:'captains-deck',label:'Captain Deck'}}}];
  state.reconcileProjects(rows,keyOf);
  assert.equal(rows[0].parent,'fixture:project:captains-deck');
  assert.equal(rows.find(row => row.kind === 'project').title,'Captain Deck');
});

test('flow project identity repairs a missing snapshot parent', () => {
  const rows = [{kind:'task',home:'fixture',parent:'',card:{flow:{project:{id:'project:firstmate',label:'Firstmate'}}}}];
  state.reconcileProjects(rows,keyOf);
  assert.equal(rows[0].parent,'fixture:project:firstmate');
  assert.equal(rows.find(row => row.kind === 'project').title,'Firstmate');
});

test('canonical project identity links to an existing project node', () => {
  const rows = [{kind:'project',home:'fixture',owner_id:'project:firstmate',id:'fixture:project:firstmate'},
    {kind:'task',home:'fixture',parent:'',card:{project:{id:'project:firstmate',label:'Firstmate'}}}];
  state.reconcileProjects(rows,keyOf);
  assert.equal(rows[1].parent,rows[0].id);
  assert.equal(rows.filter(row => row.kind === 'project').length,1);
});

test('canonical object identities fill absent aliases and full progress stays distinct from completion', () => {
  assert.equal(state.identity({task:'audit'}),'task:audit');
  assert.equal(state.identity({owner_id:'project:firstmate'}),'project:firstmate');
  assert.equal(state.identity({alias:'T-2W8',task:'audit'}),'T-2W8');
  assert.equal(state.completionNote(100,'active'),true);
  assert.equal(state.completionNote(100,'done'),false);
  assert.equal(state.completionNote(80,'active'),false);
});
