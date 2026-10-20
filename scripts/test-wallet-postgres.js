'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {PrismaClient}=require('@prisma/client');
const {grantSubscription,chargeCredit,refundCredit}=require('../lib/wallet');
const source=process.env.AUDIT_DATABASE_URL;
if(!source)throw new Error('AUDIT_DATABASE_URL required; uses an isolated temporary schema');
const schema='cg_audit_'+crypto.randomBytes(8).toString('hex');
const admin=new PrismaClient({datasources:{db:{url:source}}});
const url=new URL(source);url.searchParams.set('schema',schema);
const db=new PrismaClient({datasources:{db:{url:url.toString()}}});
(async()=>{
 try{
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await admin.$executeRawUnsafe(`CREATE TABLE "${schema}".users (id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,credits INTEGER NOT NULL DEFAULT 0,subscription_credits INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP(3) NOT NULL)`);
  await admin.$executeRawUnsafe(`CREATE TABLE "${schema}".credit_transactions (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES "${schema}".users(id),delta INTEGER NOT NULL,reason TEXT NOT NULL,stripe_payment_intent_id TEXT UNIQUE,meta TEXT,created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`);
  await db.user.create({data:{id:'fixture',email:'fixture@example.invalid',passwordHash:'not-a-login',credits:10}});
  await Promise.all(Array.from({length:5},()=>grantSubscription(db,'fixture',7,'invoice_fixture','subscription_cycle_reset',{})));
  let user=await db.user.findUnique({where:{id:'fixture'}});assert.equal(user.credits,17);assert.equal(user.subscriptionCredits,7);
  assert.equal(await db.creditTransaction.count(),1);
  const charged=await Promise.all(Array.from({length:18},()=>chargeCredit(db,'fixture','vin_full_report',{})));
  assert.equal(charged.filter(r=>r.ok).length,17);
  user=await db.user.findUnique({where:{id:'fixture'}});assert.equal(user.credits,0);assert.equal(user.subscriptionCredits,0);
  await Promise.all(Array.from({length:5},()=>refundCredit(db,'fixture',charged.find(r=>r.ok).ctxId)));
  user=await db.user.findUnique({where:{id:'fixture'}});assert.equal(user.credits,1);
  await grantSubscription(db,'fixture',7,'invoice_next','subscription_cycle_reset',{});
  user=await db.user.findUnique({where:{id:'fixture'}});assert.equal(user.credits,8);assert.equal(user.subscriptionCredits,7);
  console.log('PASS PostgreSQL concurrency: duplicate grants, overspending, duplicate refunds and purchased-credit preservation');
 }finally{
  await db.$disconnect();
  await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.$disconnect();
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
