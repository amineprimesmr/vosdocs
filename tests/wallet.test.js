'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {grantSubscription,chargeCredit,refundCredit}=require('../lib/wallet');
const {ensureSubscription}=require('../lib/subscription-create');

function database(credits=10,subscriptionCredits=0) {
 const state={user:{id:'u',credits,subscriptionCredits},entries:[]};let tail=Promise.resolve();
 const update=({data})=>{for(const [key,value] of Object.entries(data))state.user[key]=typeof value==='object'?state.user[key]+(value.increment||0)-(value.decrement||0):value;return {...state.user};};
 const tx={user:{update:async a=>update(a),findUnique:async()=>({...state.user}),updateMany:async a=>{if(state.user.credits<a.where.credits.gte)return {count:0};update(a);return {count:1};}},creditTransaction:{findUnique:async({where})=>state.entries.find(e=>Object.entries(where).every(([k,v])=>e[k]===v))||null,create:async({data})=>{const entry={id:'tx'+state.entries.length,...data};state.entries.push(entry);return entry;}}};
 const db={$transaction:fn=>{const next=tail.then(()=>fn(tx));tail=next.catch(()=>{});return next;}};
 return {db,state};
}
test('renewal replaces only monthly credits, retaining purchases and consuming monthly first',async()=>{
 const {db,state}=database(10);
 await grantSubscription(db,'u',7,'pi_1','subscription_initial_grant',{});
 assert.equal(state.user.credits,17);assert.equal(state.user.subscriptionCredits,7);
 await chargeCredit(db,'u','vin_full_report',{});
 assert.equal(state.user.credits,16);assert.equal(state.user.subscriptionCredits,6);
 await grantSubscription(db,'u',7,'in_2','subscription_cycle_reset',{});
 assert.equal(state.user.credits,17);assert.equal(state.user.subscriptionCredits,7);
});
test('concurrent duplicate renewal and refund are applied once',async()=>{
 const {db,state}=database(3);
 await Promise.all(Array.from({length:3},()=>grantSubscription(db,'u',7,'same_invoice','subscription_cycle_reset',{})));
 assert.equal(state.user.credits,10);assert.equal(state.entries.length,1);
 const debit=await chargeCredit(db,'u','vin_full_report',{});
 await Promise.all([refundCredit(db,'u',debit.ctxId),refundCredit(db,'u',debit.ctxId)]);
 assert.equal(state.user.credits,10);assert.equal(state.entries.filter(e=>e.reason==='vin_decode_refund').length,1);
 await assert.rejects(refundCredit(db,'u','not-a-debit'));
});
test('concurrent requests cannot overspend the final credit',async()=>{
 const {db,state}=database(1);
 const results=await Promise.all([chargeCredit(db,'u','vin_full_report',{}),chargeCredit(db,'u','vin_full_report',{})]);
 assert.equal(results.filter(r=>r.ok).length,1);assert.equal(state.user.credits,0);
});
test('subscription creation uses a stable key and finds previous creation before retry',async()=>{
 const calls=[];let existing=[];
 const stripe={subscriptions:{list:async()=>({data:existing,has_more:false}),create:async(payload,opts)=>{calls.push({payload,opts});return {id:'sub_new',metadata:payload.metadata};}}};
 const options={customerId:'cus_fixture',paymentMethodId:'pm_fixture',priceId:'price_fixture',userId:'u',creditsPerCycle:7,trialDays:1};
 const first=await ensureSubscription(stripe,{id:'pi_fixture'},options);
 await ensureSubscription(stripe,{id:'pi_fixture'},options);
 assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].payload.trial_period_days,1);
 existing=[first];await ensureSubscription(stripe,{id:'pi_fixture'},options);assert.equal(calls.length,2);
 await assert.rejects(ensureSubscription(stripe,{id:'pi_missing'},{...options,paymentMethodId:''}));
});
