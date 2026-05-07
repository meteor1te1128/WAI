// Vercel 需要关闭默认的 body parser，Stripe 签名验证要用原始 body
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const Stripe = (await import('stripe')).default;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook 签名验证失败:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  // 写入 / 更新 Supabase 的辅助函数
  async function upsertSubscription(data) {
    const url = `${process.env.SUPABASE_URL}/rest/v1/subscriptions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates', // upsert
      },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const err = await response.text();
      console.error('Supabase upsert 失败:', err);
    }
  }

  try {
    switch (event.type) {

      // 订阅创建成功（首次付款完成）
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.supabase_user_id;
        if (!userId) break;

        // 获取订阅详情拿到 current_period_end
        const subscription = await stripe.subscriptions.retrieve(session.subscription);

        await upsertSubscription({
          user_id: userId,
          plan: 'pro',
          status: 'active',
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        });
        console.log(`✅ Pro 订阅激活：user ${userId}`);
        break;
      }

      // 订阅续费成功
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        if (invoice.billing_reason !== 'subscription_cycle') break;

        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        const userId = subscription.metadata?.supabase_user_id;
        if (!userId) break;

        await upsertSubscription({
          user_id: userId,
          plan: 'pro',
          status: 'active',
          stripe_customer_id: invoice.customer,
          stripe_subscription_id: invoice.subscription,
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        });
        console.log(`🔄 Pro 订阅续费：user ${userId}`);
        break;
      }

      // 续费失败
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        const userId = subscription.metadata?.supabase_user_id;
        if (!userId) break;

        await upsertSubscription({
          user_id: userId,
          plan: 'pro',
          status: 'past_due',
          stripe_customer_id: invoice.customer,
          stripe_subscription_id: invoice.subscription,
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        });
        console.log(`⚠️ 续费失败：user ${userId}`);
        break;
      }

      // 用户主动取消订阅
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const userId = subscription.metadata?.supabase_user_id;
        if (!userId) break;

        await upsertSubscription({
          user_id: userId,
          plan: 'pro',
          status: 'cancelled',
          stripe_customer_id: subscription.customer,
          stripe_subscription_id: subscription.id,
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        });
        console.log(`❌ 订阅取消：user ${userId}`);
        break;
      }

      default:
        // 其他事件不处理
        break;
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('Webhook 处理错误:', err);
    return res.status(500).json({ error: '处理失败' });
  }
}
