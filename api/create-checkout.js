export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, userEmail, plan = 'pro', amount, interval } = req.body;
  if (!userId || !userEmail) {
    return res.status(400).json({ error: '需要登录才能订阅' });
  }

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const SITE_URL = process.env.SITE_URL || 'https://wai-phi-swart.vercel.app';

  const plans = {
    pro:  { name: 'WAI Pro',  description: '每天 10 次 · 6 种风格 · 无水印 · 2K 高清 · 30 天历史记录', amount: 990,  interval: 'month' },
    max:  { name: 'WAI Max',  description: '无限次数 · 4K 超清 · 永久历史 · 商业授权 · 新风格优先体验',  amount: 2900, interval: 'month' },
  };

  const selectedPlan = plans[plan] || plans.pro;
  const finalAmount   = (plan === 'max' && amount)   ? amount   : selectedPlan.amount;
  const finalInterval = (plan === 'max' && interval) ? interval : selectedPlan.interval;

  const intervalToMonths = { month: 1, quarter: 3, halfyear: 6, year: 12 };
  const months = intervalToMonths[finalInterval] || 1;

  const intervalLabels = { month: '1个月', quarter: '3个月', halfyear: '6个月', year: '1年' };
  const label = intervalLabels[finalInterval] || '1个月';

  try {
    // 查找或创建 Stripe 客户
    const searchRes = await fetch(
      `https://api.stripe.com/v1/customers/search?query=email:'${encodeURIComponent(userEmail)}'&limit=1`,
      { headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` } }
    );
    const searchData = await searchRes.json();
    let customerId;
    if (searchData.data?.length > 0) {
      customerId = searchData.data[0].id;
    } else {
      const createRes = await fetch('https://api.stripe.com/v1/customers', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: userEmail,
          'metadata[supabase_user_id]': userId,
        }).toString(),
      });
      customerId = (await createRes.json()).id;
    }

    // 一次性付款，mode: payment
    const sessionParams = new URLSearchParams({
      customer: customerId,
      mode: 'payment',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][product_data][name]': `${selectedPlan.name} · ${label}`,
      'line_items[0][price_data][product_data][description]': selectedPlan.description,
      'line_items[0][price_data][unit_amount]': String(finalAmount),
      'line_items[0][quantity]': '1',
      success_url: `${SITE_URL}?payment=success`,
      cancel_url:  `${SITE_URL}?payment=cancel`,
      'metadata[supabase_user_id]': userId,
      'metadata[plan]': plan,
      'metadata[interval]': finalInterval,
      'metadata[months]': String(months),
    });

    const sessionRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: sessionParams.toString(),
    });

    const session = await sessionRes.json();
    if (session.error) return res.status(500).json({ error: session.error.message });
    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('Stripe checkout error:', err);
    return res.status(500).json({ error: '创建支付会话失败，请稍后重试' });
  }
}
