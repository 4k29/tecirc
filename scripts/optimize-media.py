#!/usr/bin/env python3
"""Generate display-only WebP variants; preserve original URLs and editor inputs."""
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SETTINGS = 'webp-v1:edge=2000:widths=640,1280:quality=82:method=6'


def generate(root=ROOT):
    manifest_path = root / '_data/media.json'
    previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    manifest = {}
    for section in ('memory', 'notes'):
        for source in sorted((root / 'images' / section).glob('*')):
            if source.suffix.lower() not in ('.jpg', '.jpeg', '.png', '.webp'):
                continue
            key = '/' + source.relative_to(root).as_posix()
            digest = hashlib.sha256(source.read_bytes() + SETTINGS.encode()).hexdigest()
            cached = previous.get(key)
            if cached and cached['digest'] == digest and all((root / v['src'].lstrip('/')).is_file() for v in cached['variants']):
                manifest[key] = cached
                continue
            with Image.open(source) as original:
                if getattr(original, 'is_animated', False):
                    continue  # Never flatten an animation into a still image.
                image = ImageOps.exif_transpose(original)
                profile = original.info.get('icc_profile', b'')
                image = image.convert('RGBA' if 'A' in image.getbands() or 'transparency' in image.info else 'RGB')
                image.thumbnail((2000, 2000), Image.Resampling.LANCZOS)
                width, height = image.size
                variants = []
                for size in sorted({min(640, width), min(1280, width), width}):
                    output = root / 'images/optimized' / section / (source.name + '-' + str(size) + '.webp')
                    output.parent.mkdir(parents=True, exist_ok=True)
                    resized = image.resize((size, max(1, round(height * size / width))), Image.Resampling.LANCZOS)
                    resized.save(output, 'WEBP', quality=82, method=6, icc_profile=profile)
                    variants.append({'src': '/' + output.relative_to(root).as_posix(), 'width': size, 'bytes': output.stat().st_size})
                manifest[key] = {'digest': digest, 'src': variants[-1]['src'], 'width': width, 'height': height, 'original_bytes': source.stat().st_size, 'variants': variants}
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    # Only remove generated derivatives that no longer have an original source.
    referenced = {v['src'] for entry in manifest.values() for v in entry['variants']}
    for output in (root / 'images/optimized').rglob('*.webp'):
        if '/' + output.relative_to(root).as_posix() not in referenced:
            output.unlink()
    return manifest


if __name__ == '__main__':
    result = generate()
    for section in ('memory', 'notes'):
        entries = [v for k, v in result.items() if k.startswith('/images/' + section + '/')]
        before = sum(e['original_bytes'] for e in entries)
        full = sum(e['variants'][-1]['bytes'] for e in entries)
        small = sum(e['variants'][0]['bytes'] for e in entries)
        print(f'{section}: {len(entries)} images; originals {before:,} B; full WebP {full:,} B; 640px {small:,} B')
