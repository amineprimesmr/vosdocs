'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const auth = require('../lib/auth');
const { requestOrigin } = require('../lib/public-origin');
process.env.JWT_SECRET = 'test-only-session-secret';

function fixture() {
  const routes = new Map();
  const state = { updates: [], writes: [], events: [], paymentStatus: 'paid', fulfillment: {ok:true}, credits: 3 };
  const app = {disable(){},use(){},get:register('GET'),post:register('POST')};
  function register(method) { return (paths, ...handlers) => { for (const p of [].concat(paths)) routes.set(method+' '+p, handlers[handlers.length-1]); }; }
  function express() {return app;}
  express.raw = express.json = express.static = () => () => {};
  state.user = {id:'u_test', email:'fixture@example.test', passwordHash:'before', credits:3};
  const db = {
    user: {
      findUnique: async () => state.user,
      updateMany: async ({where,data}) => {
        if (where.passwordHash && where.passwordHash !== state.user.passwordHash) return {count:0};
        if(data.passwordHash) state.user.passwordHash=data.passwordHash;
        if(data.credits) state.credits--;
        return {count:1};
      },
      update: async args => {state.userUpdate=args;return state.user;}
    },
    creditTransaction: {
      create: async () => ({id:'txn_test'}),
      findUnique: async () => state.credited === false ? null : ({id:'txn_test'}),
      findFirst: async () => state.credited === false ? null : ({id:'txn_test'}),
      update: async args => {await new Promise(resolve=>setTimeout(resolve,5));state.updates.push(args);}
    },
    vinOrder:{findUnique:async()=>null},
    emailDelivery:{findUnique:async()=>null},
    $transaction: async fn => {if(state.failDb)throw new Error('database offline');return fn(db);}
  };
  state.db=db;
  const limits=new Map();
  db.$queryRaw=async(strings,key)=>{const hits=(limits.get(key)||0)+1;limits.set(key,hits);return [{hits}];};
  const stripe = {
    subscriptions:{retrieve:async id=>({id,metadata:{purpose:'subscription_monthly_credits',userId:'u_test',creditsPerCycle:'7'}})},
    webhooks:{constructEvent:()=>state.event},
    checkout:{sessions:{
      list:async()=>({data:[]}),
      retrieve:async()=>({id:'cs_fixture',mode:'payment',payment_status:state.paymentStatus,customer_email:'fixture@example.test',payment_intent:{id:'pi_fixture',metadata:{}}}),
      create:async data=>{state.sessionData=data;return {url:'https://checkout.stripe.com/fixture'};}
    }},
    prices:{list:async()=>({data:[],has_more:false})}
  };
  const fakeFs = {...fs,existsSync:()=>false,writeFileSync:(...args)=>state.writes.push(args)};
  const deps = {
    express, stripe: function(){return stripe;}, 'cookie-parser':()=>()=>{}, dotenv:{config(){}}, fs:fakeFs,
    './lib/prisma':{getPrisma:()=>state.db}, './lib/auth':auth,
    './lib/fulfill-vin-order':{
      appBaseUrl:req=>requestOrigin(req)||'https://www.carvinguard.fr',
      paymentIntentToOrder:pi=>({id:pi.id}),
      fulfillGuestVinOrder:async()=>state.fulfillment
    },
    './lib/order-emails':{sendTeamOrderEmail:async()=>({sent:true}),sendAccountInviteEmail:async opts=>{state.inviteEmail=opts;return {sent:true};},sendWalletCreditsEmail:async()=>({sent:true})},
    './lib/report-pdf':{generateReportPdfBuffer:async()=>Buffer.from('fixture')},
    './lib/carapi-client':{}, './lib/vin-provider':{getVinDecodeProvider:()=>({id:'vehicledatabases',apiKey:'fixture'}),getOptionalCarApiToken:()=>null},
    './lib/vehicledatabases-client':{}, './lib/vin-decode-core':{},
    './lib/blog-config':{getBlogConfig:()=>({baseUrl:'https://www.carvinguard.fr'})},
    './lib/public-origin':require('../lib/public-origin'),
    './lib/wallet':require('../lib/wallet'),
    './lib/rate-limit':require('../lib/rate-limit'),
    './lib/email-delivery':require('../lib/email-delivery'),
    './lib/subscription-create':require('../lib/subscription-create'),
    './lib/subscriptions':require('../lib/subscriptions'),
    './lib/blog':{}, './lib/blog-render':{}
  };
  const env={VERCEL:'1',NODE_ENV:'production',STRIPE_SECRET_KEY:'sk_test_fixture',JWT_SECRET:process.env.JWT_SECRET,STRIPE_WEBHOOK_SECRET:'whsec_fixture',CRON_SECRET:'cron_fixture'};
  const context=vm.createContext({
    require:name=>Object.hasOwn(deps,name)?deps[name]:require(name), module:{exports:{}},
    __dirname:path.resolve(__dirname,'..'), process:{env}, Buffer, URL, AbortSignal, setTimeout, clearTimeout,
    console:{log(){},warn(){},error(...args){state.events.push(args.map(String).join(' '));}},
    fetch:async()=>({ok:true,status:200,json:async()=>({status:'success',data:{make:'Test',model:'Fixture',year:'2020'}})})
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../server.js'),'utf8'),context);
  async function call(method,url,req={}) {
    const fn=routes.get(method+' '+url);assert.ok(fn,'route '+url);
    const result={status:200,body:null,headers:{}};
    const res={status(n){result.status=n;return this;},json(body){result.body=body;return this;},send(body){result.body=body;return this;},end(){return this;},setHeader(k,v){result.headers[k]=v;},redirect(code,url){result.status=code;result.body=url;},cookie(){},clearCookie(){}};
    await fn({params:{},query:{},headers:{},cookies:{},body:{},...req},res);
    return result;
  }
  return {call,state,env};
}

test('Stripe Basil invoice parent grants the recurring credits',async()=>{
 const f=fixture();f.state.credited=false;
 f.state.event={type:'invoice.payment_succeeded',data:{object:{id:'in_fixture',amount_paid:4999,parent:{type:'subscription_details',subscription_details:{subscription:'sub_fixture'}}}}};
 const r=await f.call('POST','/api/stripe-webhook',{headers:{'stripe-signature':'fixture'}});
 assert.equal(r.status,200);assert.equal(f.state.userUpdate.data.credits.increment,7);assert.equal(f.state.userUpdate.data.subscriptionCredits,7);
});

test('account recovery sends only to the account email and returns no token',async()=>{
 const f=fixture();
 const r=await f.call('POST','/api/auth/request-access',{body:{email:'fixture@example.test'},headers:{host:'www.carvinguard.ma'}});
 assert.equal(r.status,202);assert.equal(r.body.inviteToken,undefined);
 assert.equal(f.state.inviteEmail.to,'fixture@example.test');
 assert.equal(f.state.inviteEmail.baseUrl,'https://www.carvinguard.ma');
 assert.equal(auth.verifyAccountInviteToken(f.state.inviteEmail.inviteToken,'before'),'u_test');
 f.state.inviteEmail=null;
 await f.call('POST','/api/auth/request-access',{body:{email:'fixture@example.test'}});
 assert.equal(f.state.inviteEmail,null);
 const unknown=fixture();unknown.state.user=null;
 const noAccount=await unknown.call('POST','/api/auth/request-access',{body:{email:'unknown@example.test'}});
 assert.equal(noAccount.status,202);assert.equal(noAccount.body.message,r.body.message);
 assert.equal(unknown.state.inviteEmail,undefined);
});

test('successful public VIN preview returns the real identity (no out-of-scope vinCtxId)',async()=>{
 const f=fixture();const r=await f.call('GET','/api/vin-decode/:vin',{params:{vin:'1HGCM82633A004352'},query:{preview:'1'}});
 assert.equal(r.status,200);assert.equal(r.body.data.make,'Test');assert.equal(r.body.partialDecode,undefined);assert.equal(f.state.credits,3);
});
test('paid VIN decode requires login and persists history before returning',async()=>{
 const f=fixture();const req={params:{vin:'1HGCM82633A004352'}};
 assert.equal((await f.call('GET','/api/vin-decode/:vin',req)).status,401);
 req.cookies={cg_auth:auth.signAuthToken('u_test')};
 const r=await f.call('GET','/api/vin-decode/:vin',req);
 assert.equal(r.status,200);assert.equal(f.state.credits,2);assert.equal(f.state.updates.length,1);
 assert.equal(JSON.parse(f.state.updates[0].data.meta).make,'Test');
});
test('checkout IDs cannot reset passwords, even when paid',async()=>{
 const f=fixture();f.state.paymentStatus='unpaid';
 let r=await f.call('GET','/api/billing/get-invite',{query:{session_id:'cs_fixture'}});
 assert.equal(r.status,400);assert.equal(r.body.inviteToken,undefined);
 f.state.paymentStatus='paid';r=await f.call('GET','/api/billing/get-invite',{query:{session_id:'cs_fixture'}});
 assert.equal(r.status,200,JSON.stringify(f.state.events));assert.equal(r.body.reason,'email_link_required');assert.equal(r.body.inviteToken,undefined);
});
test('activation tokens are consumed atomically',async()=>{
 const f=fixture();const token=auth.signAccountInviteToken('u_test','before');
 const req={body:{token,password:'FixturePassword123'}};
 assert.equal((await f.call('POST','/api/auth/accept-invite',req)).status,200);
 assert.equal((await f.call('POST','/api/auth/accept-invite',req)).status,400);
});
test('arbitrary payment amount and metadata endpoints are retired',async()=>{
 const f=fixture();
 for(const url of ['/api/create-payment-intent','/api/update-payment-metadata'])assert.equal((await f.call('POST',url)).status,410);
});
test('forged cron header is not authentication and missing secret denies access',async()=>{
 const f=fixture();assert.equal((await f.call('GET','/api/cron/generate-articles',{headers:{'x-vercel-cron':'1'}})).status,401);
 delete f.env.CRON_SECRET;assert.equal((await f.call('GET','/api/cron/generate-articles')).status,401);
});
test('failed report delivery causes retry, not webhook acknowledgement',async()=>{
 const f=fixture();f.state.fulfillment={ok:false,error:'email_unavailable'};
 f.state.event={type:'payment_intent.succeeded',data:{object:{id:'pi_fixture',status:'succeeded',metadata:{}}}};
 assert.equal((await f.call('POST','/api/stripe-webhook')).status,500);
});
test('credit database failure causes webhook retry',async()=>{
 const f=fixture();f.state.failDb=true;
 f.state.event={type:'payment_intent.succeeded',data:{object:{id:'pi_fixture',status:'succeeded',metadata:{purpose:'credit_purchase',userId:'u_test',credits:'3'}}}};
 assert.equal((await f.call('POST','/api/stripe-webhook')).status,500);
});
test('unpaid checkout completed does not grant credits',async()=>{
 const f=fixture();f.state.event={type:'checkout.session.completed',data:{object:{mode:'payment',payment_status:'unpaid'}}};
 assert.equal((await f.call('POST','/api/stripe-webhook')).status,200);assert.equal(f.state.writes.length,0);
});
test('checkout success and cancellation stay on .ma',async()=>{
 const f=fixture();const r=await f.call('GET','/api/billing/credit-checkout',{headers:{host:'www.carvinguard.ma'},query:{plan:'essentiel'}});
 assert.equal(r.status,303);assert.match(f.state.sessionData.success_url,/^https:\/\/www\.carvinguard\.ma\//);
 assert.equal(f.state.sessionData.cancel_url,'https://www.carvinguard.ma/checkout.html');
 assert.equal(f.state.sessionData.payment_intent_data.metadata.publicOrigin,'https://www.carvinguard.ma');
});

test('Morocco purchases retain /ma in return URLs and webhook metadata',async()=>{
 const f=fixture();
 const r=await f.call('GET','/api/billing/credit-checkout',{market:'MA',headers:{host:'www.carvinguard.fr'},query:{plan:'essentiel'}});
 assert.equal(r.status,303);
 assert.match(f.state.sessionData.success_url,/^https:\/\/www\.carvinguard\.fr\/ma\/compte\.html/);
 assert.equal(f.state.sessionData.cancel_url,'https://www.carvinguard.fr/ma/checkout.html');
 assert.equal(f.state.sessionData.metadata.publicOrigin,'https://www.carvinguard.fr/ma');
 assert.equal(f.state.sessionData.payment_intent_data.metadata.publicOrigin,'https://www.carvinguard.fr/ma');
});
