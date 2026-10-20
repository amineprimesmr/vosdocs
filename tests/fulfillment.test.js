'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function fixture() {
 const state={row:null,sends:0,pdfs:0,sent:true,decode:{status:'success',data:{make:'Test',model:'Fixture'}}};
 const bundle={vinDecode:{ok:true,data:{make:'Test'}},stolenCheck:{ok:true,data:{status:'clear'}}};
 const db={vinOrder:{
  findUnique:async()=>state.row,
  create:async({data})=>{state.row={...data};return state.row;},
  update:async({data})=>{Object.assign(state.row,data);return state.row;}
 }};
 const deps={
  './prisma':{getPrisma:()=>db},
  './vin-decode-core':{decodeVinForReport:async()=>state.decode,apiResponseToVehicleData:d=>d.data,getVinDecodeProvider:()=>({id:'vehicledatabases',apiKey:'fixture'})},
  './vehicledatabases-client':{fetchVehicleDatabasesFullEnrichment:async()=>bundle},
  './report-pdf':{generateReportPdfBuffer:async()=>{state.pdfs++;return Buffer.from('fixture');}},
  './order-emails':{sendTeamOrderEmail:async()=>({sent:true}),sendCustomerReportEmail:async()=>{state.sends++;return {sent:state.sent};}},
  './public-origin':require('../lib/public-origin')
 };
 const context=vm.createContext({require:n=>deps[n]||require(n),module:{exports:{}},process:{env:{BASE_URL:'https://www.carvinguard.fr'}},console:{warn(){},error(){},log(){}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../lib/fulfill-vin-order.js'),'utf8'),context);
 const pi={id:'pi_fixture',status:'succeeded',amount:1499,metadata:{vin:'1HGCM82633A004352',email:'fixture@example.test',publicOrigin:'https://www.carvinguard.ma'}};
 return {state,bundle,pi,fulfill:context.module.exports.fulfillGuestVinOrder};
}
test('never generates or emails a paid report from an empty fallback or unpaid intent',async()=>{
 const f=fixture();f.pi.status='processing';assert.equal((await f.fulfill(null,f.pi)).ok,false);
 f.pi.status='succeeded';f.state.decode={status:'success',partialDecode:true,data:{make:'',model:''}};
 assert.equal((await f.fulfill(null,f.pi)).ok,false);assert.equal(f.state.pdfs,0);assert.equal(f.state.sends,0);
});
test('stores the actual enrichment and keeps guest report links on .ma',async()=>{
 const f=fixture();const r=await f.fulfill(null,f.pi);assert.equal(r.ok,true);
 assert.deepEqual(JSON.parse(f.state.row.vehicleDataJson).vdBundle,f.bundle);
 assert.match(r.reportUrl,/^https:\/\/www\.carvinguard\.ma\/mon-rapport/);
 assert.equal((await f.fulfill(null,f.pi)).skipped,true);assert.equal(f.state.sends,1);
});
test('email failure is retryable and never marks the customer email delivered',async()=>{
 const f=fixture();f.state.sent=false;const r=await f.fulfill(null,f.pi);
 assert.equal(r.ok,false);assert.equal(f.state.row.customerEmailSentAt,undefined);
 f.state.sent=true;assert.equal((await f.fulfill(null,f.pi)).ok,true);assert.ok(f.state.row.customerEmailSentAt);
});
