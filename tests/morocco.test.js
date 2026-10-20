'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {requestOrigin,trustedOrigin}=require('../lib/public-origin');
const client=require('../lib/carapi-client');
test('Morocco checkout and email origins retain only trusted /ma prefix',()=>{
 assert.equal(requestOrigin({headers:{host:'www.carvinguard.fr'},market:'MA'}),'https://www.carvinguard.fr/ma');
 assert.equal(trustedOrigin('https://www.carvinguard.fr/ma'),'https://www.carvinguard.fr/ma');
 assert.equal(trustedOrigin('https://www.carvinguard.fr/malicious'),'https://www.carvinguard.fr');
 assert.equal(trustedOrigin('https://www.carvinguard.fr.evil.test/ma'),null);
});
test('Morocco enrichment never queries foreign valuation, inspection, theft or loan endpoints',async()=>{
 const saved=global.fetch;const calls=[];
 global.fetch=async raw=>{const u=new URL(raw);calls.push(u.pathname);return {ok:true,status:200,text:async()=>JSON.stringify({make:'Honda',model:'Accord',year:2003}),json:async()=>({make:'Honda',model:'Accord',year:2003})};};
 try{
  const b=await client.fetchCarApiFullEnrichment('fixture',{vin:'1HGCM82633A004352',country:'MA'});
  assert.equal(b.country,'MA');
  assert.equal(b.vehicleValuation.skipped,true);
  assert.equal(b.inspection.skipped,true);
  assert.equal(b.stolenCheck.skipped,true);
  assert.equal(b.payments.skipped,true);
  assert.ok(calls.some(p=>p.includes('vin-decode')));
  assert.ok(calls.every(p=>!/(vehicle-valuation|inspection|stolen-check|payments|listing)/.test(p)));
 }finally{global.fetch=saved;}
});
