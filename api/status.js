export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Missing prediction id' });
  }

  try {
    const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: {
        'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}`,
      },
    });

    const result = await pollRes.json();

    if (result.status === 'succeeded') {
      const imageUrl = Array.isArray(result.output) ? result.output[0] : result.output;
      return res.status(200).json({ status: 'succeeded', imageUrl });
    } else if (result.status === 'failed') {
      return res.status(200).json({ status: 'failed', error: result.error || '生成失败' });
    } else {
      // still processing
      return res.status(200).json({ status: result.status });
    }

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '查询失败' });
  }
}
