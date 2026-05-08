export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { imageBase64, style } = req.body;
  if (!imageBase64) {
    return res.status(400).json({ error: '请上传图片' });
  }

  const styleMap = {
    '新海诚': {
      style: '3D',
      prompt: 'makoto shinkai anime style, beautiful sky, cinematic soft lighting, pastel colors',
      negative_prompt: 'ugly, blurry, bad anatomy, extra limbs',
    },
    '吉卜力': {
      style: '3D',
      prompt: 'studio ghibli anime style, hayao miyazaki, warm natural colors, magical atmosphere',
      negative_prompt: 'ugly, blurry, bad anatomy, realistic photo',
    },
    '赛博朋克': {
      style: '3D',
      prompt: 'cyberpunk anime style, neon lights, futuristic, dark atmosphere, glowing effects',
      negative_prompt: 'ugly, blurry, bad anatomy',
    },
    '少年漫画': {
      style: '3D',
      prompt: 'shonen manga anime style, vibrant colors, dynamic, bold outlines, expressive eyes',
      negative_prompt: 'ugly, blurry, bad anatomy, realistic',
    },
    '黑暗幻想': {
      style: '3D',
      prompt: 'dark fantasy anime style, dramatic lighting, mysterious atmosphere, detailed',
      negative_prompt: 'ugly, blurry, bad anatomy, bright colors',
    },
    '治愈系': {
      style: '3D',
      prompt: 'cute healing anime style, soft pastel colors, kawaii, warm gentle lighting',
      negative_prompt: 'ugly, blurry, bad anatomy, dark, scary',
    },
  };

  const selected = styleMap[style] || styleMap['新海诚'];

  try {
    const startRes = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: 'a07f252abbbd832009640b27f063ea52d87d7a23a185ca165bec23b5adc8deaf',
        input: {
          image: imageBase64,
          style: selected.style,
          prompt: selected.prompt,
          negative_prompt: selected.negative_prompt,
          num_steps: 20,
          guidance_scale: 7.5,
          ip_adapter_scale: 0.8,
          reserve_face_weight: 0.8,
        },
      }),
    });

    const prediction = await startRes.json();
    console.log('Prediction started:', prediction.id, 'error:', prediction.error);

    if (prediction.error) {
      return res.status(500).json({ error: prediction.error });
    }

    return res.status(200).json({ predictionId: prediction.id });

  } catch (err) {
    console.error('generate error:', err);
    return res.status(500).json({ error: '服务器错误，请稍后重试' });
  }
}
