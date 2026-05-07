export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, userEmail } = req.body;

  if (!userId || !userEmail) {
    return res.status(400).json({ error: '需要登录才能订阅' });
  }

  try {
    // 动态导入 stripe（Vercel serverless 环境）
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // 查找或创建 Stripe Customer（避免重复创建）
    let customerId;
    const existing = await stripe.customers.list({ email: userEmail, limit: 1 });
    if (existing.data.length > 0) {
      customerId = existing.data[0].id;
    } else {
      const customer = await stripe.customers.create({
        email: userEmail,
        metadata: { supabase_user_id: userId },
      });
      customerId = customer.id;
    }

    // 创建 Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'WAI Pro',
              description: '每天 30 次生成 · 12 种风格 · 无水印 · 2K 高清 · 30 天历史记录',
            },
            unit_amount: 1900, // $19.00（单位：分）
            recurring: { interval: 'month' },
          },
          quantity: 1,
        },
      ],
      // 付款成功/取消跳转地址
      success_url: `${process.env.SITE_URL || 'https://wai-phi-swart.vercel.app'}?payment=success`,
      cancel_url: `${process.env.SITE_URL || 'https://wai-phi-swart.vercel.app'}?payment=cancel`,
      // 传入 userId，webhook 里用来更新 Supabase
      metadata: { supabase_user_id: userId },
      subscription_data: {
        metadata: { supabase_user_id: userId },
      },
    });

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('Stripe checkout error:', err);
    return res.status(500).json({ error: '创建支付会话失败，请稍后重试' });
  }
}
