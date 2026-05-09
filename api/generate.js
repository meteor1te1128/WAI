export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { imageBase64, style } = req.body;
  if (!imageBase64) {
    return res.status(400).json({ error: '请上传图片' });
  }

  // ─── 风格映射 ───────────────────────────────────────────────
  // 全部使用 flux-kontext-apps/face-to-many-kontext
  // 该模型接受 input_image URL，需先上传到 Supabase Storage
  // style 枚举来自模型官方 schema（已截图确认）
  const styleMap = {
    '🌿 吉卜力风': {
      style: 'Watercolor',
      prompt: 'Studio Ghibli anime watercolor painting, soft hand-painted brushstrokes, Miyazaki aesthetic, warm pastel palette, expressive eyes, dreamy lush background, gentle cinematic lighting',
      negative_prompt: 'realistic, photo, 3d render, ugly, blurry, bad anatomy, nsfw, dark, horror',
    },
    '🧸 黏土风': {
      style: 'Clay',
      prompt: 'cute claymation character portrait, smooth matte clay texture, round chubby face, soft diffused studio lighting, pastel colors, stop-motion animation style, highly detailed clay sculpt',
      negative_prompt: 'realistic, photo, ugly, blurry, flat, 2d, dark, horror, nsfw',
    },
    '👾 像素风': {
      style: 'Pixel Art',
      prompt: '16-bit RPG pixel art portrait, grid-aligned pixel blocks, limited vibrant color palette, retro game character sprite, sharp crisp pixel edges, classic JRPG style',
      negative_prompt: 'blurry, smooth, anti-aliased, realistic, 3d, ugly, noisy',
    },
    '✨ 动漫风': {
      style: 'Anime',
      prompt: 'Japanese anime portrait, big bright expressive eyes, clean sharp lineart, vibrant cel shading, professional manga illustration, dramatic lighting, detailed hair',
      negative_prompt: 'realistic, photo, 3d, ugly, blurry, bad anatomy, nsfw, western cartoon',
    },
    '🎨 漫画风': {
      style: 'Cartoon',
      prompt: 'stylized cartoon character portrait, bold clean outlines, vivid saturated colors, expressive exaggerated features, modern animation style, professional character design',
      negative_prompt: 'realistic, photo, ugly, blurry, bad anatomy, nsfw, horror',
    },
  };

  // 兼容旧风格名称（平滑过渡，防止前端缓存旧数据）
  const legacyMap = {
    '吉卜力风':  '🌿 吉卜力风',
    '迪士尼3D':  '🧸 黏土风',
    '像素风':    '👾 像素风',
    '游戏角色':  '✨ 动漫风',
    '动漫风':    '🎨 漫画风',
  };

  const resolvedStyle = styleMap[style]
    ? style
    : legacyMap[style]
      ? legacyMap[style]
      : '🌿 吉卜力风';

  const selected = styleMap[resolvedStyle];

  // ─── 上传图片到 Supabase Storage，拿公开 URL ───────────────
  // face-to-many-kontext 只接受 URL，不接受 base64
  const pureBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const imgBuffer = Buffer.from(pureBase64, 'base64');

  const fileName = `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;

  const uploadRes = await fetch(
    `${process.env.SUPABASE_URL}/storage/v1/object/uploads/${fileName}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'image/jpeg',
        'x-upsert': 'true',
      },
      body: imgBuffer,
    }
  );

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    console.error('Supabase upload failed:', err);
    return res.status(500).json({ error: '图片上传失败，请重试' });
  }

  const imageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/uploads/${fileName}`;

  // ─── 调用 face-to-many-kontext ────────────────────────────
  // 注意：使用 /v1/models/{owner}/{name}/predictions 路径，无需 version hash
  try {
    const startRes = await fetch(
      'https://api.replicate.com/v1/models/flux-kontext-apps/face-to-many-kontext/predictions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: {
            style: selected.style,
            prompt: selected.prompt,
            negative_prompt: selected.negative_prompt,
            input_image: imageUrl,
            num_images: 1,
            aspect_ratio: 'match_input_image',
            output_format: 'png',
            preserve_outfit: false,
            preserve_background: false,
            safety_tolerance: 2,
          },
        }),
      }
    );

    const prediction = await startRes.json();

    if (prediction.error) {
      console.error('Replicate error:', prediction.error);
      return res.status(500).json({ error: prediction.error });
    }

    return res.status(200).json({
      predictionId: prediction.id,
      tmpFile: fileName,       // status.js 轮询完成后用来删除临时文件
    });

  } catch (err) {
    console.error('generate error:', err);
    return res.status(500).json({ error: '服务器错误，请稍后重试' });
  }
}
