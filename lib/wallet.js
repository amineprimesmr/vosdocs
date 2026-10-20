'use strict';

// All balance changes are serialized on the user row. Existing balances migrate
// as purchased credits, so introducing the subscription bucket removes nothing.
async function grantSubscription(prisma, userId, allowance, key, reason, meta) {
  if (!Number.isSafeInteger(allowance) || allowance < 1) throw new Error('Invalid allowance');
  try {
    return await prisma.$transaction(async tx => {
      const user = await tx.user.update({where:{id:userId},data:{credits:{increment:0}}});
      if (await tx.creditTransaction.findUnique({where:{stripePaymentIntentId:key}})) return false;
      const oldSubscription = Math.max(0, Math.min(user.credits, user.subscriptionCredits || 0));
      const delta = allowance - oldSubscription;
      await tx.user.update({where:{id:userId},data:{credits:{increment:delta},subscriptionCredits:allowance}});
      await tx.creditTransaction.create({data:{userId,delta,reason,stripePaymentIntentId:key,meta:JSON.stringify(meta || {})}});
      return true;
    });
  } catch (e) { if (e.code === 'P2002') return false; throw e; }
}

async function chargeCredit(prisma, userId, reason, meta) {
  return prisma.$transaction(async tx => {
    const charged = await tx.user.updateMany({where:{id:userId,credits:{gte:1}},data:{credits:{decrement:1}}});
    if (!charged.count) {
      const user = await tx.user.findUnique({where:{id:userId},select:{credits:true}});
      return {ok:false,credits:user?.credits || 0};
    }
    const user = await tx.user.findUnique({where:{id:userId},select:{subscriptionCredits:true}});
    const subscription = (user?.subscriptionCredits || 0) > 0;
    if (subscription) await tx.user.update({where:{id:userId},data:{subscriptionCredits:{decrement:1}}});
    const entry = await tx.creditTransaction.create({data:{userId,delta:-1,reason,meta:JSON.stringify({...meta,creditBucket:subscription?'subscription':'purchased'})}});
    return {ok:true,ctxId:entry.id};
  });
}

async function refundCredit(prisma, userId, transactionId) {
  if (!transactionId) throw new Error('Missing debit reference for refund');
  try {
    return await prisma.$transaction(async tx => {
      await tx.user.update({where:{id:userId},data:{credits:{increment:0}}});
      const debit = await tx.creditTransaction.findUnique({where:{id:transactionId}});
      if (!debit || debit.userId !== userId || debit.delta !== -1) throw new Error('Invalid debit reference');
      const key = 'refund_' + transactionId;
      if (await tx.creditTransaction.findUnique({where:{stripePaymentIntentId:key}})) return false;
      // A failed report is refunded as a non-expiring credit, including across a renewal.
      await tx.user.update({where:{id:userId},data:{credits:{increment:1}}});
      await tx.creditTransaction.create({data:{userId,delta:1,reason:'vin_decode_refund',stripePaymentIntentId:key,meta:JSON.stringify({refundOf:transactionId})}});
      return true;
    });
  } catch (e) { if (e.code === 'P2002') return false; throw e; }
}

module.exports = {grantSubscription,chargeCredit,refundCredit};
