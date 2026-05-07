export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  try {
    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/generations?user_id=eq.${userId}&order=created_at.desc&limit=12`,
      {
        headers: {
          'apikey': process.env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        }
      }
    );

    const data = await response.json();
    return res.status(200).json(data);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '读取失败' });
  }
}
