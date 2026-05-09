export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { imageBase64, style } = req.body;
  if (!imageBase64) {
    return res.status(400).json({ error: '请上传图片' });
  }

  const pureBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');

  const FACE_TO_MANY = 'edc6439ac55af138defbca7c472b38bcdd62c61797e8e0c2fae88696cd8afb25';
  const PHOTOMAKER  = '467d062309da518648ba89d226490e02b8ed09b5abc15026e54e31c5a8cd0769';

  const styleMap = {
    '吉卜力风': {
      model: 'photomaker',
      prompt: 'img, Studio Ghibli anime style painting, soft watercolor, hand-drawn, Miyazaki aesthetic, warm pastel colors, expressive eyes, dreamy background, gentle lighting',
      negative_prompt: 'realistic, photo, 3d render, ugly, blurry, bad anatomy, dark, horror, nsfw',
      style_name: '(No style)',
      num_steps: 50,
      style_strength_ratio: 35,
      guidance_scale: 5,
    },
    '迪士尼3D': {
      model: 'face-to-many',
      style: '3D',
      prompt: 'a person, Pixar Disney 3D animation, smooth round face, big expressive eyes, vibrant colors, cinematic lighting',
      negative_prompt: 'ugly, blurry, bad anatomy, flat, 2d, realistic',
      num_steps: 20,
      guidance_scale: 7.5,
      ip_adapter_scale: 0.8,
      reserve_face_weight: 0.8,
    },
    '像素风': {
      model: 'face-to-many',
      style: 'Pixels',
      prompt: 'a person, retro pixel art portrait, 16bit RPG game character, vibrant pixel colors',
      negative_prompt: 'blurry, realistic, smooth, 3d, ugly',
      num_steps: 20,
      guidance_scale: 7.5,
      ip_adapter_scale: 0.8,
      reserve_face_weight: 0.8,
    },
    '游戏角色': {
      model: 'face-to-many',
      style: 'Video game',
      prompt: 'a person, fantasy RPG hero, detailed epic armor, game character art, dynamic lighting',
      negative_prompt: 'ugly, blurry, bad anatomy, realistic photo',
      num_steps: 20,
      guidance_scale: 7.5,
      ip_adapter_scale: 0.8,
      reserve_face_weight: 0.8,
    },
    '动漫风': {
      model: 'photomaker',
      prompt: 'img, Japanese anime portrait, big bright eyes, clean sharp lineart, vibrant cel shading, manga illustration',
      negative_prompt: 'realistic, photo, 3d, ugly, blurry, bad anatomy, nsfw',
      style_name: '(No style)',
      num_steps: 50,
      style_strength_ratio: 35,
      guidance_scale: 5,
    },
  };

  const selected = styleMap[style] || styleMap['动漫风'];

  try {
    if (selected.model === 'photomaker') {
      // 先上传图片到 Supabase Storage 拿 URL
      const fileName = `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
      const imgBuffer = Buffer.from(pureBase64, 'base64');

      const uploadRes = await fetch(
        `${process.env.SUPABASE_URL}/storage/v1/object/uploads/${fileName}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'image/jpeg',
          },
          body: imgBuffer,
        }
      );

      if (!uploadRes.ok) {
        const err = await uploadRes.text();
        console.error('Upload failed:', err);
        return res.status(500).json({ error: '图片上传失败，请重试' });
      }

      const imageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/uploads/${fileName}`;

      const startRes = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: {
          'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          version: PHOTOMAKER,
          input: {
            prompt: selected.prompt,
            negative_prompt: selected.negative_prompt,
            style_name: selected.style_name,
            input_image: imageUrl,
            num_steps: selected.num_steps,
            style_strength_ratio: selected.style_strength_ratio,
            guidance_scale: selected.guidance_scale,
            num_outputs: 1,
          },
        }),
      });

      const prediction = await startRes.json();
      if (prediction.error) {
        return res.status(500).json({ error: prediction.error });
      }
      return res.status(200).json({ predictionId: prediction.id, tmpFile: fileName });
    }

    // face-to-many
    const startRes = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: FACE_TO_MANY,
        input: {
          image: `data:image/jpeg;base64,${pureBase64}`,
          style: selected.style,
          prompt: selected.prompt,
          negative_prompt: selected.negative_prompt,
          num_steps: selected.num_steps,
          guidance_scale: selected.guidance_scale,
          ip_adapter_scale: selected.ip_adapter_scale,
          reserve_face_weight: selected.reserve_face_weight,
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
