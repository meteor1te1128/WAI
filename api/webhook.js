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
    console.error('Signature mismatch!');
    console.error('Expected:', expected);
    console.error('Received:', parts.v1);
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
      `${baseUrl}/rest/v1/subscriptions?user_id=eq.${data.user_id}&select=id&limit=1`,
      { headers }
    );
    const existing = await checkRes.json();
    console.log('Existing records:', JSON.stringify(existing));

    if (Array.isArray(existing) && existing.length > 0) {
      console.log('Updating existing record for user:', data.user_id);
      const updateRes = await fetch(
        `${baseUrl}/rest/v1/subscriptions?user_id=eq.${data.user_id}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            plan: data.plan,
            status: data.status,
            stripe_customer_id: data.stripe_customer_id,
            stripe_subscription_id: data.stripe_subscription_id,
            current_period_end: data.current_period_end,
          }),
        }
      );
      if (!updateRes.ok) {
        console.error('Supabase PATCH failed:', updateRes.status, await updateRes.text());
      } else {
        console.log('Supabase PATCH success');
      }
    } else {
      console.log('Inserting new record for user:', data.user_id);
      const insertRes = await fetch(
        `${baseUrl}/rest/v1/subscriptions`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(data),
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

async function getStripeSubscription(subscriptionId) {
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
    headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}` },
  });
  if (!res.ok) {
    console.error('Stripe fetch subscription failed:', res.status, await res.text());
    return null;
  }
  return res.json();
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
        console.log('Session subscription:', session.subscription);
        console.log('Session customer:', session.customer);

        const userId = session.metadata?.supabase_user_id;
        const plan = session.metadata?.plan || 'pro';
        const interval = session.metadata?.interval || 'month';

        if (!userId) {
          console.error('No supabase_user_id in metadata!');
          break;
        }

        const intervalToMonths = { month: 1, quarter: 3, halfyear: 6, year: 12 };
        const extendMonths = intervalToMonths[interval] || 1;

        let periodEnd;
        if (session.subscription) {
          const subscription = await getStripeSubscription(session.subscription);
          periodEnd = subscription?.current_period_end
            ? new Date(subscription.current_period_end * 1000).toISOString()
            : new Date(Date.now() + extendMonths * 30 * 24 * 60 * 60 * 1000).toISOString();
        } else {
          console.log('subscription not yet attached, using fallback period end');
          periodEnd = new Date(Date.now() + extendMonths * 30 * 24 * 60 * 60 * 1000).toISOString();
        }

        await upsertSubscription({
          user_id: userId,
          plan,
          status: 'active',
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription || null,
          current_period_end: periodEnd,
        });
        console.log(`✅ ${plan} 订阅激活 (${interval})：user ${userId}`);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;

        if (!['subscription_create', 'subscription_cycle'].includes(invoice.billing_reason)) {
          console.log('Skipping invoice, billing_reason:', invoice.billing_reason);
          break;
        }

        const subscription = await getStripeSubscription(invoice.subscription);
        if (!subscription) break;

        const userId = subscription.metadata?.supabase_user_id;
        const plan = subscription.metadata?.plan || 'pro';
        if (!userId) {
          console.error('No supabase_user_id in subscription metadata');
          break;
        }

        await upsertSubscription({
          user_id: userId,
          plan,
          status: 'active',
          stripe_customer_id: invoice.customer,
          stripe_subscription_id: invoice.subscription,
          current_period_end: subscription.current_period_end
            ? new Date(subscription.current_period_end * 1000).toISOString()
            : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        });
        console.log(`🔄 ${invoice.billing_reason === 'subscription_create' ? '首次付款' : '续费'}成功：user ${userId}`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscription = await getStripeSubscription(invoice.subscription);
        if (!subscription) break;

        const userId = subscription.metadata?.supabase_user_id;
        if (!userId) break;

        await upsertSubscription({
          user_id: userId,
          plan: subscription.metadata?.plan || 'pro',
          status: 'past_due',
          stripe_customer_id: invoice.customer,
          stripe_subscription_id: invoice.subscription,
          current_period_end: subscription.current_period_end
            ? new Date(subscription.current_period_end * 1000).toISOString()
            : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        });
        console.log(`⚠️ 付款失败：user ${userId}`);
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
          current_period_end: subscription.current_period_end
            ? new Date(subscription.current_period_end * 1000).toISOString()
            : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        });
        console.log(`❌ 订阅取消：user ${userId}`);
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
