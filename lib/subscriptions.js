'use strict';
async function ownedSubscriptions(stripe,user) {
  const customers = await stripe.customers.list({email:user.email,limit:100});
  const results=[];
  for (const customer of customers.data) {
    let cursor;
    do {
      const page=await stripe.subscriptions.list({customer:customer.id,status:'all',limit:100,...(cursor?{starting_after:cursor}:{})});
      for(const sub of page.data) if(sub.metadata?.userId===user.id && sub.metadata?.purpose==='subscription_monthly_credits') {
        results.push({id:sub.id,status:sub.status,cancelAtPeriodEnd:sub.cancel_at_period_end,
          periodEnd:sub.current_period_end || sub.items?.data?.[0]?.current_period_end || sub.trial_end || null});
      }
      cursor=page.has_more&&page.data.length?page.data[page.data.length-1].id:null;
    } while(cursor);
  }
  return results;
}
async function cancelOwnedSubscription(stripe,userId,subscriptionId) {
  const sub=await stripe.subscriptions.retrieve(subscriptionId);
  if(sub.metadata?.userId!==userId || sub.metadata?.purpose!=='subscription_monthly_credits') return null;
  if(['canceled','incomplete_expired'].includes(sub.status) || sub.cancel_at_period_end) return sub;
  return stripe.subscriptions.update(sub.id,{cancel_at_period_end:true});
}
module.exports={ownedSubscriptions,cancelOwnedSubscription};
