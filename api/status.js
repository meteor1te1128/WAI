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

      // 免费用户加服务端水印
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
          for (let y = -h; y < h * 2; y += gap) {
            for (let x = -w; x < w * 2; x += gap) {
              svgLines += `<text x="${x}" y="${y}" font-size="${fontSize}" fill="white" fill-opacity="0.22" font-family="sans-serif" font-weight="bold" transform="rotate(-30)">${'WAI.app'}</text>`;
            }
          }
          const svgWatermark = Buffer.from(
            `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${svgLines}</svg>`
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
      return res.status(200).json({ status: 'failed', error: result.error || '生成失败' });
    } else {
      return res.status(200).json({ status: result.status });
    }

  } catch (err) {
    console.error('status error:', err);
    return res.status(500).json({ error: '查询失败' });
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
