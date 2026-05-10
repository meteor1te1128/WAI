export const config = {
  api: { bodyParser: false },
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function verifySignature(rawBody, sigHeader, secret) {
  const parts = {};
  sigHeader.split(',').forEach(item => {
    const [key, value] = item.split('=');
    parts[key.trim()] = value.trim();
  });

  if (!parts.t || !parts.v1) {
    console.error('Missing t or v1 in signature header:', sigHeader);
    return false;
  }

  const signedPayload = `${parts.t}.${rawBody.toString()}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const expected = Array.from(new Uint8Array(sigBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const isValid = expected === parts.v1;
  if (!isValid) {
    console.error('Signature mismatch! Expected:', expected, 'Received:', parts.v1);
  }
  return isValid;
}

async function upsertSubscription(data) {
  console.log('Upserting to Supabase:', JSON.stringify(data));
  const baseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
  };

  try {
    const checkRes = await fetch(
      `${baseUrl}/rest/v1/subscriptions?user_id=eq.${data.user_id}&select=id,current_period_end&limit=1`,
      { headers }
    );
    const existing = await checkRes.json();
    console.log('Existing records:', JSON.stringify(existing));

    // 叠加时间：如果已有未过期记录，在原到期时间基础上加；否则从现在开始算
    let newPeriodEnd = data.current_period_end;
    if (data.extend_months && Array.isArray(existing) && existing.length > 0) {
      const currentEnd = existing[0].current_period_end;
      const base = (currentEnd && new Date(currentEnd) > new Date())
        ? new Date(currentEnd)
        : new Date();
      base.setMonth(base.getMonth() + data.extend_months);
      newPeriodEnd = base.toISOString();
      console.log('Extended period end to:', newPeriodEnd);
    }

    if (Array.isArray(existing) && existing.length > 0) {
      console.log('Updating existing record for user:', data.user_id);
      const updateRes = await fetch(
        `${baseUrl}/rest/v1/subscriptions?user_id=eq.${data.user_id}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            plan: data.plan,
            status: 'active',
            stripe_customer_id: data.stripe_customer_id,
            stripe_subscription_id: null,
            current_period_end: newPeriodEnd,
          }),
        }
      );
      if (!updateRes.ok) {
        console.error('Supabase PATCH failed:', updateRes.status, await updateRes.text());
      } else {
        console.log('Supabase PATCH success, new period end:', newPeriodEnd);
      }
    } else {
      console.log('Inserting new record for user:', data.user_id);
      const insertRes = await fetch(
        `${baseUrl}/rest/v1/subscriptions`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            user_id: data.user_id,
            plan: data.plan,
            status: 'active',
            stripe_customer_id: data.stripe_customer_id,
            stripe_subscription_id: null,
            current_period_end: newPeriodEnd,
          }),
        }
      );
      if (!insertRes.ok) {
        console.error('Supabase POST failed:', insertRes.status, await insertRes.text());
      } else {
        console.log('Supabase POST success');
      }
    }
  } catch (e) {
    console.error('upsertSubscription error:', e);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('=== Webhook received ===');

  let rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch (err) {
    console.error('Failed to read body:', err);
    return res.status(400).json({ error: 'Bad request' });
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) {
    console.error('No stripe-signature header');
    return res.status(400).json({ error: 'No signature' });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET not set!');
    return res.status(500).json({ error: 'Server config error' });
  }

  const valid = await verifySignature(rawBody, sig, webhookSecret);
  if (!valid) {
    console.error('Invalid signature');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  console.log('Signature valid ✅');

  const event = JSON.parse(rawBody.toString());
  console.log('Event type:', event.type);

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object;
        console.log('Session metadata:', JSON.stringify(session.metadata));

        // 只处理一次性付款
        if (session.mode !== 'payment') {
          console.log('Skipping non-payment session, mode:', session.mode);
          break;
        }

        const userId   = session.metadata?.supabase_user_id;
        const plan     = session.metadata?.plan || 'pro';
        const months   = parseInt(session.metadata?.months || '1');

        if (!userId) {
          console.error('No supabase_user_id in metadata!');
          break;
        }

        // 计算到期时间（会在 upsertSubscription 里叠加）
        const periodEnd = new Date();
        periodEnd.setMonth(periodEnd.getMonth() + months);

        await upsertSubscription({
          user_id: userId,
          plan,
          status: 'active',
          stripe_customer_id: session.customer,
          current_period_end: periodEnd.toISOString(),
          extend_months: months,
        });

        console.log(`✅ ${plan} 激活 (+${months}个月)：user ${userId}`);
        break;
      }

      default:
        console.log('Unhandled event type:', event.type);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook processing error:', err);
    return res.status(500).json({ error: 'Processing failed' });
  }
}
