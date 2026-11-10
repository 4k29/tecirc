// Validate optional display variants without requiring Pillow for Doctor.
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
export async function checkMedia(root) {
  const manifest = JSON.parse(await readFile(path.join(root, '_data/media.json'), 'utf8'));
  for (const [source, image] of Object.entries(manifest)) {
    if (!/^\/images\/(notes|memory)\/[A-Za-z0-9._()-]+\.(?:jpe?g|png|webp)$/i.test(source)) throw new Error(`Unexpected media source: ${source}`);
    await access(path.join(root, source));
    if (!(image.width > 0 && image.height > 0) || !image.variants.length) throw new Error(`Missing image dimensions: ${source}`);
    let previousWidth = 0;
    for (const variant of image.variants) {
      if (!/^\/images\/optimized\/(notes|memory)\/[A-Za-z0-9._()-]+\.webp$/.test(variant.src) || variant.width <= previousWidth || variant.width > image.width) throw new Error(`Invalid display variant: ${source}`);
      const bytes = await readFile(path.join(root, variant.src));
      if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.length !== variant.bytes) throw new Error(`Invalid WebP: ${variant.src}`);
      previousWidth = variant.width;
    }
    if (image.src !== image.variants.at(-1).src) throw new Error(`Invalid full image: ${source}`);
  }
  return Object.keys(manifest).length;
}
