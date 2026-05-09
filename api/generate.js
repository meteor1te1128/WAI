export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { imageBase64, style } = req.body;
  if (!imageBase64) {
    return res.status(400).json({ error: '请上传图片' });
  }
  const styleMap = {
    '3D建模': {
      style: '3D',
      prompt: 'a person, 3d rendered, pixar style, smooth lighting, detailed face',
      negative_prompt: 'ugly, blurry, bad anatomy',
    },
    '表情包': {
      style: 'Emoji',
      prompt: 'a person, emoji style, expressive, cute, bold lines',
      negative_prompt: 'ugly, blurry, bad anatomy',
    },
    '游戏角色': {
      style: 'Video game',
      prompt: 'a person, video game character, rpg style, detailed armor, fantasy',
      negative_prompt: 'ugly, blurry, bad anatomy',
    },
    '像素风': {
      style: 'Pixels',
      prompt: 'a person, pixel art style, retro game, 16bit',
      negative_prompt: 'ugly, blurry, bad anatomy',
    },
    '黏土风': {
      style: 'Clay',
      prompt: 'a person, claymation style, stop motion, clay texture, soft colors',
      negative_prompt: 'ugly, blurry, bad anatomy',
    },
    '玩具风': {
      style: 'Toy',
      prompt: 'a person, toy figure, plastic texture, collectible, detailed',
      negative_prompt: 'ugly, blurry, bad anatomy',
    },
  };
  const selected = styleMap[style] || styleMap['3D建模'];

  // 去掉 data:image/xxx;base64, 前缀，只传纯 base64
  const pureBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');

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
          image: `data:image/jpeg;base64,${pureBase64}`,
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
    if (prediction.error) {
      return res.status(500).json({ error: prediction.error });
    }
    return res.status(200).json({ predictionId: prediction.id });
  } catch (err) {
    console.error('generate error:', err);
    return res.status(500).json({ error: '服务器错误，请稍后重试' });
  }
}
