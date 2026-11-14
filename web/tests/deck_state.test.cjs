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
  assert.equal(rows.find(row => row.kind === 'project').title,'Unresolved project: Captain Deck');
});

test('flow project identity repairs a missing snapshot parent', () => {
  const rows = [{kind:'task',home:'fixture',parent:'',card:{flow:{project:{id:'project:firstmate',label:'Firstmate'}}}}];
  state.reconcileProjects(rows,keyOf);
  assert.equal(rows[0].parent,'fixture:project:firstmate');
  assert.equal(rows.find(row => row.kind === 'project').title,'Unresolved project: Firstmate');
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

test('retained tasks recover a project container from the recorded canonical identity', () => {
  const rows = [{kind:'task',home:'real',parent:'real:project:retired',raw:{project:'project:retired'}},
    {kind:'task',home:'real',parent:'',raw:{repository_project:'project:retired'}},
    {kind:'task',home:'real',parent:'',raw:{project:null}}];
  state.reconcileProjects(rows,keyOf);
  assert.equal(rows[0].parent,'real:project:retired');
  assert.equal(rows[1].parent,'real:project:retired');
  assert.equal(rows[2].parent,''); // No project is inferred from a title or task slug.
  assert.equal(rows.find(row=>row.kind==='project').title,'Unresolved project: retired');
  assert.equal(rows.filter(row=>row.kind==='project').length,1);
});

test('a declared pause overrides the active snapshot for presentation', () => {
  assert.equal(state.displayState({state:'active',card:{activity:{kind:'paused'}}}),'paused');
  assert.equal(state.displayState({state:'active',card:{activity:{kind:'working'}}}),'active');
  assert.equal(state.displayState({state:'done',card:{activity:{kind:'paused'}}}),'done');
});

test('finished and missing workers wait for reconciliation rather than appearing active or queued', () => {
  assert.equal(state.displayState({state:'ready',raw:{backlog_state:'in_flight'}}),'unknown');
  for (const kind of ['finished','missing']) for (const ownerState of ['active','ready']) {
    assert.equal(state.displayState({state:ownerState,card:{activity:{kind}}}),'waiting');
    assert.equal(state.displayState({state:'done',card:{activity:{kind}}}),'done');
  }
});

test('a project absent from inventory is visibly unresolved without classifying missing metadata as host work', () => {
  const rows = [{kind:'task',home:'fixture',parent:'',raw:{project:'project:missing'}},
    {kind:'task',home:'fixture',parent:'',raw:{project:null}}];
  const translate = (text, values) => text === 'Unresolved project: {project}' ? 'Proyecto sin resolver: '+values.project : text;
  state.reconcileProjects(rows,keyOf,translate);
  assert.equal(rows.find(row=>row.kind==='project').title,'Proyecto sin resolver: missing');
  assert.equal(rows[1].parent,'');
});
