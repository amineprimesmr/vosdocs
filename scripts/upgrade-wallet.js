'use strict';
const fs=require('node:fs');const path=require('node:path');
const {PrismaClient}=require('@prisma/client');
const db=new PrismaClient();
(async()=>{
 try{
  await db.$transaction(async tx=>{
    const before=await tx.user.aggregate({_count:true,_sum:{credits:true}});
    const statements=fs.readFileSync(path.join(__dirname,'../prisma/upgrade-wallet.sql'),'utf8').split(';').map(s=>s.trim()).filter(Boolean);
    for(const statement of statements)await tx.$executeRawUnsafe(statement);
    const after=await tx.user.aggregate({_count:true,_sum:{credits:true}});
    if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Unexpected balance change during migration');
    console.log('Additive wallet migration: account count and all existing credit totals preserved');
  });
 }finally{await db.$disconnect();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
