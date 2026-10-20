'use strict';
async function deliver(row, prisma, senders) {
  if (!row || row.sentAt) return;
  await prisma.emailDelivery.update({where:{id:row.id},data:{attempts:{increment:1}}});
  const sender = row.payload.kind === 'invite' ? senders.invite : senders.wallet;
  const result = await sender({...row.payload.options,idempotencyKey:row.id});
  if (!result?.sent) throw new Error('Email delivery failed; retry required');
  await prisma.emailDelivery.update({where:{id:row.id},data:{sentAt:new Date()}});
}
async function queuePurchaseEmail(prisma, sessionId, payload, senders) {
  const id = 'checkout-email-' + sessionId;
  const row = await prisma.emailDelivery.upsert({where:{id},create:{id,payload},update:{}});
  return deliver(row,prisma,senders);
}
async function retryPurchaseEmail(prisma,sessionId,senders) {
  if (!prisma) throw new Error('Email delivery storage unavailable');
  return deliver(await prisma.emailDelivery.findUnique({where:{id:'checkout-email-'+sessionId}}),prisma,senders);
}
module.exports={queuePurchaseEmail,retryPurchaseEmail};
