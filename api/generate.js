export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { imageBase64, style } = req.body;
  if (!imageBase64) {
    return res.status(400).json({ error: '请上传图片' });
  }

  // ─── 风格映射 ───────────────────────────────────────────────
  // 前五个：flux-kontext-apps/face-to-many-kontext（接受 URL）
  // 第六个：zsxkib/flux-pulid — FLUX.1-dev 底座，NeurIPS 2024，保脸精度最高
  //         接受 main_face_image（URL 或 base64 均可，这里传 URL）
  const styleMap = {
    '🌿 吉卜力风': {
      model: 'kontext',
      style: 'Watercolor',
      prompt: 'Studio Ghibli anime watercolor painting, soft hand-painted brushstrokes, Miyazaki aesthetic, warm pastel palette, expressive eyes, dreamy lush background, gentle cinematic lighting',
      negative_prompt: 'realistic, photo, 3d render, ugly, blurry, bad anatomy, nsfw, dark, horror',
    },
    '🧸 黏土风': {
      model: 'kontext',
      style: 'Clay',
      prompt: 'cute claymation character portrait, smooth matte clay texture, round chubby face, soft diffused studio lighting, pastel colors, stop-motion animation style, highly detailed clay sculpt',
      negative_prompt: 'realistic, photo, ugly, blurry, flat, 2d, dark, horror, nsfw',
    },
    '👾 像素风': {
      model: 'kontext',
      style: 'Pixel Art',
      prompt: '16-bit RPG pixel art portrait, grid-aligned pixel blocks, limited vibrant color palette, retro game character sprite, sharp crisp pixel edges, classic JRPG style',
      negative_prompt: 'blurry, smooth, anti-aliased, realistic, 3d, ugly, noisy',
    },
    '✨ 动漫风': {
      model: 'kontext',
      style: 'Anime',
      prompt: 'Japanese anime portrait, big bright expressive eyes, clean sharp lineart, vibrant cel shading, professional manga illustration, dramatic lighting, detailed hair',
      negative_prompt: 'realistic, photo, 3d, ugly, blurry, bad anatomy, nsfw, western cartoon',
    },
    '🎨 漫画风': {
      model: 'kontext',
      style: 'Cartoon',
      prompt: 'stylized cartoon character portrait, bold clean outlines, vivid saturated colors, expressive exaggerated features, modern animation style, professional character design',
      negative_prompt: 'realistic, photo, ugly, blurry, bad anatomy, nsfw, horror',
    },
    '🖼️ 油画风': {
      model: 'pulid',
      // flux-pulid 用 prompt 驱动风格，不需要 style 枚举
      prompt: 'oil painting portrait, impressionist brushstrokes, museum quality fine art, rich deep colors, Rembrandt dramatic lighting, masterpiece canvas texture, detailed facial features, classical European painting style',
      negative_prompt: 'photo, realistic, 3d, anime, cartoon, ugly, blurry, watermark, nsfw',
      // pulid 参数
      num_steps: 20,
      start_step: 0,       // 0-1 for stylized，保脸+风格都好
      guidance_scale: 4,
      width: 896,
      height: 1152,
    },
  };

  // 兼容旧风格名称
  const legacyMap = {
    '吉卜力风': '🌿 吉卜力风',
    '迪士尼3D': '🧸 黏土风',
    '像素风':   '👾 像素风',
    '游戏角色': '✨ 动漫风',
    '动漫风':   '🎨 漫画风',
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

  // ─── 调用模型 ────────────────────────────────────────────
  try {
    let startRes;

    if (selected.model === 'pulid') {
      // ── zsxkib/flux-pulid ──────────────────────────────────
      // 用 /v1/models/{owner}/{name}/predictions，无需 version hash
      // main_face_image 接受 URL
      startRes = await fetch(
        'https://api.replicate.com/v1/models/zsxkib/flux-pulid/predictions',
        {
          method: 'POST',
          headers: {
            'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            input: {
              main_face_image: imageUrl,
              prompt: selected.prompt,
              negative_prompt: selected.negative_prompt,
              num_steps: selected.num_steps,
              start_step: selected.start_step,
              guidance_scale: selected.guidance_scale,
              width: selected.width,
              height: selected.height,
              num_outputs: 1,
              output_format: 'png',
            },
          }),
        }
      );
    } else {
      // ── flux-kontext-apps/face-to-many-kontext ─────────────
      startRes = await fetch(
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
    }

    const prediction = await startRes.json();

    if (prediction.error) {
      console.error('Replicate error:', prediction.error);
      return res.status(500).json({ error: prediction.error });
    }

    return res.status(200).json({
      predictionId: prediction.id,
      tmpFile: fileName,
    });

  } catch (err) {
    console.error('generate error:', err);
    return res.status(500).json({ error: '服务器错误，请稍后重试' });
  }
}
