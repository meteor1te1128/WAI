export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb',
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { imageBase64, style, accessToken } = req.body;

  // ── Auth check ──────────────────────────────────────────────────────────────
  if (!accessToken) {
    return res.status(401).json({ error: 'Please sign in to continue' });
  }

  let authedUser = null;
  try {
    const userRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'apikey': process.env.SUPABASE_ANON_KEY,
      },
    });
    const userData = await userRes.json();
    if (userData?.id) authedUser = userData;
  } catch (e) {
    console.error('Auth check failed:', e);
  }

  if (!authedUser) {
    return res.status(401).json({ error: 'Session expired, please sign in again' });
  }
  // ────────────────────────────────────────────────────────────────────────────

  if (!imageBase64) {
    return res.status(400).json({ error: 'Missing image' });
  }

  const styleMap = {
    '🌿 Ghibli': {
      style: 'Anime',
      prompt: 'Studio Ghibli anime style portrait, Miyazaki aesthetic, big expressive eyes, soft hand-drawn look, warm pastel colors, dreamy lush background, gentle cinematic lighting, anime film still',
      negative_prompt: 'realistic, photo, 3d render, ugly, blurry, bad anatomy, nsfw, dark, horror, western cartoon',
    },
    '🧸 Clay': {
      style: 'Clay',
      prompt: 'cute claymation character portrait, smooth matte clay texture, round chubby face, soft diffused studio lighting, pastel colors, stop-motion animation style, highly detailed clay sculpt',
      negative_prompt: 'realistic, photo, ugly, blurry, flat, 2d, dark, horror, nsfw',
    },
    '👾 Pixel Art': {
      style: 'Pixel Art',
      prompt: '16-bit RPG pixel art portrait, grid-aligned pixel blocks, limited vibrant color palette, retro game character sprite, sharp crisp pixel edges, classic JRPG style',
      negative_prompt: 'blurry, smooth, anti-aliased, realistic, 3d, ugly, noisy',
    },
    '✨ Anime': {
      style: 'Anime',
      prompt: 'Japanese anime portrait, big bright expressive eyes, clean sharp lineart, vibrant cel shading, professional manga illustration, dramatic lighting, detailed hair',
      negative_prompt: 'realistic, photo, 3d, ugly, blurry, bad anatomy, nsfw, western cartoon',
    },
    '🎨 Pixar': {
      style: 'Anime',
      prompt: 'Pixar 3D animation style portrait, high quality Disney Pixar movie character, smooth glossy skin, big expressive eyes, soft studio lighting, vivid cheerful colors, detailed hair, clean bright background, cinematic 3D render, cute and charming face',
      negative_prompt: 'realistic, photo, 2d, flat, ugly, blurry, bad anatomy, nsfw, dark, horror, sketch, painting',
    },
    '🖼️ Oil Paint': {
      style: 'Watercolor',
      prompt: 'classical oil painting portrait, museum masterpiece, rich impasto brushstrokes, Rembrandt dramatic chiaroscuro lighting, deep warm amber tones, Renaissance fine art canvas texture, highly detailed face, old master painting style',
      negative_prompt: 'anime, cartoon, 3d render, photo, realistic, ugly, blurry, nsfw, modern, digital art',
    },
  };

  const legacyMap = {
    '🌿 吉卜力风': '🌿 Ghibli',
    '🧸 黏土风':   '🧸 Clay',
    '👾 像素风':   '👾 Pixel Art',
    '✨ 动漫风':   '✨ Anime',
    '🎨 皮克斯风': '🎨 Pixar',
    '🖼️ 油画风':  '🖼️ Oil Paint',
  };

  const resolvedStyle = styleMap[style]
    ? style
    : legacyMap[style]
      ? legacyMap[style]
      : '🌿 Ghibli';

  const selected = styleMap[resolvedStyle];

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
    return res.status(500).json({ error: 'Image upload failed, please try again' });
  }

  const imageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/uploads/${fileName}`;

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
      tmpFile: fileName,
    });

  } catch (err) {
    console.error('generate error:', err);
    return res.status(500).json({ error: 'Server error, please try again' });
  }
}
