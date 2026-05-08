export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { imageBase64, style } = req.body;
  if (!imageBase64) {
    return res.status(400).json({ error: '请上传图片' });
  }

  const stylePrompts = {
    '新海诚': 'img, makoto shinkai anime style, beautiful detailed sky, cinematic lighting, soft pastel colors, detailed background',
    '吉卜力': 'img, studio ghibli anime style, hayao miyazaki, warm natural colors, magical whimsical atmosphere, detailed',
    '赛博朋克': 'img, cyberpunk anime style, neon lights, futuristic city background, dark atmosphere, glowing effects',
    '少年漫画': 'img, shonen manga anime style, bright vibrant colors, dynamic composition, bold outlines, expressive',
    '黑暗幻想': 'img, dark fantasy anime style, dramatic lighting, mysterious dark atmosphere, detailed',
    '治愈系': 'img, cute healing anime style, soft pastel colors, kawaii, warm gentle lighting, fluffy',
  };

  const prompt = stylePrompts[style] || stylePrompts['新海诚'];

  try {
    // 第一步：把 base64 上传到 Supabase Storage，拿到公开 URL
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const mimeMatch = imageBase64.match(/^data:(image\/\w+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const ext = mimeType.split('/')[1] || 'jpg';
    const fileName = `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

    const imageBuffer = Buffer.from(base64Data, 'base64');

    const uploadRes = await fetch(
      `${process.env.SUPABASE_URL}/storage/v1/object/uploads/${fileName}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': mimeType,
          'x-upsert': 'true',
        },
        body: imageBuffer,
      }
    );

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error('Supabase upload failed:', uploadRes.status, errText);
      return res.status(500).json({ error: '图片上传失败，请重试' });
    }

    // 构造公开 URL
    const imageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/uploads/${fileName}`;
    console.log('Uploaded image URL:', imageUrl);

    // 第二步：调用 PhotoMaker
    const startRes = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: '467d062309da518648ba89d226490e02b8ed09b5abc15026e54e31c5a8cd0769',
        input: {
          prompt: prompt,
          input_image: imageUrl,
          num_steps: 50,
          num_outputs: 1,
          style_strength_ratio: 35,
          negative_prompt: 'realistic, photo-realistic, worst quality, greyscale, bad anatomy, bad hands, error, text',
        },
      }),
    });

    const prediction = await startRes.json();
    console.log('Prediction started:', prediction.id, 'error:', prediction.error);

    if (prediction.error) {
      // 清理临时文件
      cleanupTempFile(fileName);
      return res.status(500).json({ error: prediction.error });
    }

    // 把临时文件名存到 prediction，方便 status.js 完成后清理
    return res.status(200).json({
      predictionId: prediction.id,
      tmpFile: fileName,
    });

  } catch (err) {
    console.error('generate error:', err);
    return res.status(500).json({ error: '服务器错误，请稍后重试' });
  }
}

// 异步删除临时文件（不阻塞响应）
async function cleanupTempFile(fileName) {
  try {
    await fetch(
      `${process.env.SUPABASE_URL}/storage/v1/object/uploads/${fileName}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
      }
    );
    console.log('Cleaned up temp file:', fileName);
  } catch (e) {
    console.warn('Cleanup failed:', e);
  }
}
