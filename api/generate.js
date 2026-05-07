export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { imageBase64, style } = req.body;

  if (!imageBase64) {
    return res.status(400).json({ error: '请上传图片' });
  }

  const promptMap = {
    '新海诚': 'a photo of a person img, makoto shinkai anime style, beautiful sky background, soft cinematic lighting',
    '吉卜力': 'a photo of a person img, studio ghibli style, hayao miyazaki, warm colors, magical atmosphere',
    '赛博朋克': 'a photo of a person img, cyberpunk style, neon lights, futuristic city background',
    '少年漫画': 'a photo of a person img, shonen manga style, bright colors, bold outlines, dynamic',
    '黑暗幻想': 'a photo of a person img, dark fantasy style, dramatic lighting, mysterious atmosphere',
    '治愈系': 'a photo of a person img, cute kawaii style, pastel colors, soft warm lighting',
  };

  const styleMap = {
    '新海诚': 'Anime',
    '吉卜力': 'Anime',
    '赛博朋克': 'Neon Punk',
    '少年漫画': 'Anime',
    '黑暗幻想': 'Dark fantasy',
    '治愈系': 'Cute Colorful',
  };

  const prompt = promptMap[style] || promptMap['新海诚'];
  const styleName = styleMap[style] || 'Anime';

  try {
    const startRes = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: '467d062309da518648ba89d226490e02b8ed09b5abc15026e54e31c5a8cd0769',
        input: {
          input_image: imageBase64,
          prompt: prompt,
          style_name: styleName,
          num_outputs: 1,
          guidance_scale: 5,
          num_inference_steps: 20,
        },
      }),
    });

    const prediction = await startRes.json();

    if (prediction.error) {
      return res.status(500).json({ error: prediction.error });
    }

    // 只返回 prediction ID，不等待结果
    return res.status(200).json({ predictionId: prediction.id });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '服务器错误，请稍后重试' });
  }
}
