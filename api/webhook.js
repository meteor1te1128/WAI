export const config = {
  api: { bodyParser: false },
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// 手动验证 Stripe webhook 签名（不依赖 stripe 包）
async function verifyStripeSignature(rawBody, signature, secret) {
  const [, timestampPart, , v1Part] = signature.split(/[=,]/);
  const timestamp = timestampPart;
  const v1 = v1Part;

  const signedPayload = `${timestamp}.${rawBody.toString()}`;

  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(signedPayload);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  const expectedSig = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  return expectedSig === v1;
}

async function upsertSubscription(data) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/subscriptions`, {
    method: 'POST',
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) console.error('Supabase upsert failed:', await res.text());
}

async function getSubscription(subscriptionId) {
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
    headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}` },
  });
  return res.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  // 解析签名头
  const sigParts = {};
  sig.split(',').forEach(part => {
    const [k, v] = part.split('=');
    sigParts[k] = v;
  });

  const signedPayload = `${sigParts.t}.${rawBody.toString()}`;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(process.env.STRIPE_WEBHOOK_SECRET);
  const messageData = encoder.encode(signedPayload);

  try {
    const cryptoKey = await crypto.subtle.importKey(
      'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sigBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
    const expectedSig = Array.from(new Uint8Array(sigBuffer))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    if (expectedSig !== sigParts.v1) {
      return res.status(400).json({ error: 'Invalid signature' });
    }
  } catch (err) {
    console.error('Signature verification error:', err);
    return res.status(400).json({ error: 'Signature error' });
  }

  const event = JSON.parse(rawBody.toString());

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.supabase_user_id;
        const plan = session.metadata?.plan || 'pro';
        if (!userId) break;

        const subscription = await getSubscription(session.subscription);
        await upsertSubscription({
          user_id: userId,
          plan,
          status: 'active',
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        });
        console.log(`✅ ${plan} 订阅激活：user ${userId}`);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        if (invoice.billing_reason !== 'subscription_cycle') break;
        const subscription = await getSubscription(invoice.subscription);
        const userId = subscription.metadata?.supabase_user_id;
        const plan = subscription.metadata?.plan || 'pro';
        if (!userId) break;

        await upsertSubscription({
          user_id: userId,
          plan,
          status: 'active',
          stripe_customer_id: invoice.customer,
          stripe_subscription_id: invoice.subscription,
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        });
        console.log(`🔄 续费成功：user ${userId}`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscription = await getSubscription(invoice.subscription);
        const userId = subscription.metadata?.supabase_user_id;
        if (!userId) break;

        await upsertSubscription({
          user_id: userId,
          plan: subscription.metadata?.plan || 'pro',
          status: 'past_due',
          stripe_customer_id: invoice.customer,
          stripe_subscription_id: invoice.subscription,
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const userId = subscription.metadata?.supabase_user_id;
        if (!userId) break;

        await upsertSubscription({
          user_id: userId,
          plan: subscription.metadata?.plan || 'pro',
          status: 'cancelled',
          stripe_customer_id: subscription.customer,
          stripe_subscription_id: subscription.id,
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        });
        console.log(`❌ 订阅取消：user ${userId}`);
        break;
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: '处理失败' });
  }
}
