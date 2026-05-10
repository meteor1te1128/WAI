import sharp from 'sharp';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id, tmpFile, plan } = req.query;
  if (!id) {
    return res.status(400).json({ error: 'Missing prediction id' });
  }

  try {
    const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: {
        'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}`,
      },
    });
    const result = await pollRes.json();

    if (result.status === 'succeeded') {
      const imageUrl = Array.isArray(result.output) ? result.output[0] : result.output;
      if (tmpFile) cleanupTempFile(tmpFile);

      if (plan === 'free') {
        try {
          const imgRes = await fetch(imageUrl);
          const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
          const meta = await sharp(imgBuffer).metadata();
          const w = meta.width || 512;
          const h = meta.height || 512;

          const fontSize = Math.max(18, Math.floor(w * 0.045));
          const gap = fontSize * 5;

          let svgLines = '';
          // 从 0 开始避免负坐标被裁掉，覆盖整个图像
          for (let row = 0; row * gap < h + gap * 2; row++) {
            for (let col = 0; col * gap < w + gap * 2; col++) {
              const x = col * gap - gap;
              const y = row * gap;
              svgLines += `<text
                x="${x}" y="${y}"
                font-size="${fontSize}"
                fill="white"
                fill-opacity="0.28"
                font-family="Arial, sans-serif"
                font-weight="bold"
                transform="rotate(-30, ${x}, ${y})"
              >WAI.app</text>`;
            }
          }

          const svgWatermark = Buffer.from(
            `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"
              style="overflow:hidden">
              ${svgLines}
            </svg>`
          );

          const watermarked = await sharp(imgBuffer)
            .composite([{ input: svgWatermark, blend: 'over' }])
            .jpeg({ quality: 90 })
            .toBuffer();

          const base64 = watermarked.toString('base64');
          return res.status(200).json({
            status: 'succeeded',
            imageUrl: `data:image/jpeg;base64,${base64}`,
          });
        } catch (wmErr) {
          console.warn('Watermark failed, returning original:', wmErr);
          return res.status(200).json({ status: 'succeeded', imageUrl });
        }
      }

      return res.status(200).json({ status: 'succeeded', imageUrl });

    } else if (result.status === 'failed') {
      if (tmpFile) cleanupTempFile(tmpFile);
      return res.status(200).json({ status: 'failed', error: result.error || 'Generation failed' });

    } else {
      return res.status(200).json({ status: result.status });
    }

  } catch (err) {
    console.error('Status check error:', err);
    return res.status(500).json({ error: 'Status check failed' });
  }
}

async function cleanupTempFile(fileName) {
  try {
    await fetch(
      `${process.env.SUPABASE_URL}/storage/v1/object/uploads/${fileName}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}` },
      }
    );
  } catch (e) {
    console.warn('Cleanup failed:', e);
  }
}
