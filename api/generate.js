export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { imageBase64, style } = req.body;

  if (!imageBase64) {
    return res.status(400).json({ error: '请上传图片' });
  }

  const stylePrompts = {
    '新海诚': 'makoto shinkai anime style, your name movie style, beautiful detailed background, soft lighting, cinematic',
    '吉卜力': 'studio ghibli anime style, hayao miyazaki, soft watercolor, magical nature background, warm colors',
    '赛博朋克': 'cyberpunk anime style, neon lights, futuristic city, dark atmosphere, glowing effects',
    '少年漫画': 'shonen manga anime style, bright colors, dynamic, action hero, bold outlines',
    '黑暗幻想': 'dark fantasy anime style, dramatic lighting, mysterious, gothic atmosphere',
    '治愈系': 'cute healing anime style, pastel colors, kawaii, soft and warm, moe style',
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

    let result = prediction;
    let attempts = 0;

    while (result.status !== 'succeeded' && result.status !== 'failed' && attempts < 30) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${result.id}`, {
        headers: {
          'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}`,
        },
      });
      result = await pollRes.json();
      attempts++;
    }

    if (result.status === 'succeeded') {
      return res.status(200).json({ imageUrl: result.output });
    } else {
      return res.status(500).json({ error: '生成失败，请重试' });
    }

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '服务器错误，请稍后重试' });
  }
}
