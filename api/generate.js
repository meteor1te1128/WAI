export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { imageBase64, style } = req.body;

  if (!imageBase64) {
    return res.status(400).json({ error: '请上传图片' });
  }

  const stylePrompts = {
    '新海诚': 'makoto shinkai anime style, beautiful sky, soft cinematic lighting, detailed',
    '吉卜力': 'studio ghibli anime style, hayao miyazaki, warm colors, magical',
    '赛博朋克': 'cyberpunk anime style, neon lights, futuristic city, dark atmosphere',
    '少年漫画': 'shonen manga anime style, bright colors, dynamic, bold outlines',
    '黑暗幻想': 'dark fantasy anime style, dramatic lighting, mysterious atmosphere',
    '治愈系': 'cute healing anime style, pastel colors, kawaii, soft warm lighting',
  };

  const prompt = stylePrompts[style] || stylePrompts['新海诚'];

  try {
    const startRes = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: '7936c014091521e64f3721090cc878ab1bceb2d5e0deecc4549092fb7f9ba753',
        input: {
          image: imageBase64,
          prompt: prompt,
        },
      }),
    });

    const prediction = await startRes.json();

    if (prediction.error) {
      return res.status(500).json({ error: prediction.error });
    }

    return res.status(200).json({ predictionId: prediction.id });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '服务器错误，请稍后重试' });
  }
}
