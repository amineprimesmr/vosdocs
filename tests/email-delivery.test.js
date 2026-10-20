'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {queuePurchaseEmail,retryPurchaseEmail}=require('../lib/email-delivery');
test('failed activation email retains the original token and is retried after credit fulfillment',async()=>{
 let row=null;let sent=false;const calls=[];
 const db={emailDelivery:{upsert:async({create})=>row||(row={...create,sentAt:null}),findUnique:async()=>row,update:async({data})=>{Object.assign(row,data);return row;}}};
 const senders={invite:async opts=>{calls.push(opts);return {sent};}};
 await assert.rejects(queuePurchaseEmail(db,'cs_1',{kind:'invite',options:{inviteToken:'original-token'}},senders));
 sent=true;await retryPurchaseEmail(db,'cs_1',senders);
 assert.equal(calls[1].inviteToken,'original-token');assert.equal(calls[1].idempotencyKey,calls[0].idempotencyKey);
 await retryPurchaseEmail(db,'cs_1',senders);assert.equal(calls.length,2);
});
