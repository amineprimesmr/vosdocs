'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {cancelOwnedSubscription,ownedSubscriptions}=require('../lib/subscriptions');
test('subscription cancellation checks ownership and changes only future renewal',async()=>{
 const updates=[];const sub={id:'sub_test',status:'active',metadata:{userId:'owner',purpose:'subscription_monthly_credits'}};
 const stripe={subscriptions:{retrieve:async()=>sub,update:async(id,data)=>{updates.push({id,data});return {...sub,...data};}}};
 assert.equal(await cancelOwnedSubscription(stripe,'other','sub_test'),null);assert.equal(updates.length,0);
 const result=await cancelOwnedSubscription(stripe,'owner','sub_test');assert.equal(result.cancel_at_period_end,true);
 assert.deepEqual(updates[0],{id:'sub_test',data:{cancel_at_period_end:true}});
 sub.cancel_at_period_end=true;await cancelOwnedSubscription(stripe,'owner','sub_test');assert.equal(updates.length,1);
});
test('subscription list filters other products and owners',async()=>{
 const stripe={customers:{list:async()=>({data:[{id:'cus_1'}]})},subscriptions:{list:async()=>({data:[
 {id:'sub_other',metadata:{userId:'other',purpose:'subscription_monthly_credits'}},
 {id:'sub_own',metadata:{userId:'owner',purpose:'subscription_monthly_credits'},items:{data:[{current_period_end:123}]}}
 ],has_more:false})}};
 const result=await ownedSubscriptions(stripe,{id:'owner',email:'fixture@example.test'});
 assert.equal(result.length,1);assert.equal(result[0].id,'sub_own');assert.equal(result[0].periodEnd,123);
});
