'use strict';
const crypto=require('node:crypto');
async function allowRequest(prisma,scope,identifier,max,seconds) {
  if(!prisma)return false;
  const id=crypto.createHash('sha256').update(scope+':'+identifier).digest('hex');
  const rows=await prisma.$queryRaw`
    INSERT INTO request_limits (id,hits,expires_at)
    VALUES (${id},1,NOW()+(${seconds} * INTERVAL '1 second'))
    ON CONFLICT (id) DO UPDATE SET
      hits=CASE WHEN request_limits.expires_at <= NOW() THEN 1 ELSE request_limits.hits+1 END,
      expires_at=CASE WHEN request_limits.expires_at <= NOW() THEN NOW()+(${seconds} * INTERVAL '1 second') ELSE request_limits.expires_at END
    RETURNING hits`;
  return rows[0].hits<=max;
}
module.exports={allowRequest};
