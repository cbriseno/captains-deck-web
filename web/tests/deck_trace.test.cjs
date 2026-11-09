/* Buffer bounds, structural pseudonyms and context selection. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

test('trace remains bounded and preserves event classes in a capped export', async () => {
  let clock = 1000000, next = 0;
  const timers = new Map(), sent = [];
  const context = vm.createContext({navigator:{userAgent:'Safari/1'}, innerWidth:1000, innerHeight:700, devicePixelRatio:2,
    matchMedia:()=>({matches:false}), addEventListener:()=>{}, document:{querySelector:()=>null},
    Date:{now:()=>clock}, setTimeout:fn=>{timers.set(++next,fn);return next;}, clearTimeout:id=>timers.delete(id)});
  context.window = context;
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/deck-trace.js'),'utf8'), context);
  const trace = context.DeckTrace;
  trace.setSender(async (events, exporting) => sent.push({events, exporting}));
  trace.move('private task name', 'now', 'waiting', 'snapshot');
  trace.mismatch('private task name', 'waiting', 'now');
  for(let i=0;i<2100;i++)trace.add('anim.cancel',{animation:'motion',duration_ms:5});
  assert.equal(Object.values(trace.counts()).reduce((a,b)=>a+b,0),2000);
  trace.add('layout',{width:1000,height:700,dpr:2,reduced:'no',browser:'safari'});
  trace.move('private task name','now','waiting','snapshot');
  await trace.flush(true);
  assert.equal(sent[0].events.length,100);
  assert.ok(sent[0].events.some(x=>x.e==='layout'));
  assert.ok(sent[0].events.some(x=>x.e==='card.move'));
  assert.ok(!JSON.stringify(sent).includes('private task name'));
  clock += 601000;
  trace.add('card.render',{duration_ms:2});
  assert.deepEqual(JSON.parse(JSON.stringify(trace.counts())),{'card.render':1});
});

test('usage sends fixed fields immediately and tolerates unavailable logging', async () => {
  const context = vm.createContext({navigator:{userAgent:''}, innerWidth:1000, innerHeight:700, devicePixelRatio:1,
    matchMedia:()=>({matches:false}), addEventListener:()=>{}, Date, setTimeout, clearTimeout});
  context.window = context;
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/deck-trace.js'),'utf8'), context);
  const trace = context.DeckTrace, sent = [];
  await trace.use('open', 'page');
  trace.setSender(async (events, exporting) => sent.push({events, exporting}));
  await trace.use('search', 'board');
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{events:[{e:'ui.use',action:'search',target:'board',age:0}],exporting:false}]);
  trace.setSender(() => {throw new Error('offline');});
  await trace.use('open', 'task');
  trace.setSender(async () => {throw new Error('rate limited');});
  await trace.use('view', 'history');
});
