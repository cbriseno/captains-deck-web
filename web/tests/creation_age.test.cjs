const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');

for(const language of ['en','es'])test('creation age uses elapsed instants and preserves date-only precision in '+language,async()=>{
  const root=path.resolve(__dirname,'..'),messages=JSON.parse(fs.readFileSync(path.join(root,'locales',language+'.json')));
  const context=vm.createContext({document:{documentElement:{},querySelectorAll(){return [];}},Intl,Date,
    fetch:async()=>({ok:true,json:async()=>({locale:language,messages})})});
  vm.runInContext(fs.readFileSync(path.join(root,'static/i18n.js'),'utf8')+'\nthis.ready=DeckI18n.ready;',context);
  const api=await context.ready,now=Date.UTC(2026,10,1,12)/1000;
  for(const [seconds,pattern]of [[720,language==='es'?/hace 12 minutos/:/12 minutes ago/],[10800,language==='es'?/hace 3 horas/:/3 hours ago/],[172800,language==='es'?/hace 2 días/:/2 days ago/]])assert.match(api.creationAge({epoch:now-seconds},now),pattern);
  const date=api.creationAge({date:'2026-11-01'},now);assert.match(date,/2026/);assert.doesNotMatch(date,/today|hoy|hace|ago|hora|minute|hour/);
  assert.match(api.exactTime({date:'2026-11-01'}),language==='es'?/hora/:/time/);
  assert.equal(api.creationAge(null,now),api.t('Not reported'));
  assert.equal(api.creationAge({epoch:now+600},now),api.t('future date; check the clock'));
});
