'use strict';
const assert=require('node:assert/strict');
const base=process.argv[2];
if(!base)throw new Error('URL requise');
(async()=>{
 for(const [p,status,fragment] of [
 ['/ma',200,'numéro de châssis'],['/ma/',200,'numéro de châssis'],
 ['/ma/checkout.html',200,'Paiement en euros'],['/ma/compte.html',200,'Maroc'],
 ['/ma/aide.html',200,'plaques marocaines'],['/ma/conditions-generales-vente.html',200,'49,99'],
 ['/ma/js/form-handler.js',200,'/api/ma/vin-decode/'],
 ['/api/ma/saas-config',200,'"market":"MA"'],
 ['/api/ma/auth/me',401,null],['/api/ma/vin-decode/INVALID?preview=1',400,null],
 ['/api/ma/billing/subscriptions',401,null],['/api/saas-config',200,'"market":"FR"']]){
  const r=await fetch(new URL(p,base),{signal:AbortSignal.timeout(20000)});const s=await r.text();
  assert.equal(r.status,status,p);if(fragment)assert.ok(s.includes(fragment),p);console.log('OK '+p);
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
