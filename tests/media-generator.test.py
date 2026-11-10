"""Small real image fixtures exercise orientation, transparency, and repeat runs."""
import importlib.util
import tempfile
import unittest
from pathlib import Path
from PIL import Image

spec = importlib.util.spec_from_file_location('media', Path(__file__).parents[1] / 'scripts/optimize-media.py')
media = importlib.util.module_from_spec(spec)
spec.loader.exec_module(media)


class MediaGenerator(unittest.TestCase):
    def test_orient_resize_cache_and_preserve_originals(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'images/memory/test.jpg'
            source.parent.mkdir(parents=True)
            image = Image.new('RGB', (2400, 1600), 'red')
            exif = image.getexif()
            exif[274] = 6
            image.save(source, exif=exif)
            original = source.read_bytes()
            entry = media.generate(root)['/images/memory/test.jpg']
            self.assertEqual((entry['width'], entry['height']), (1333, 2000))
            self.assertEqual([v['width'] for v in entry['variants']], [640, 1280, 1333])
            output = root / entry['src'].lstrip('/')
            modified = output.stat().st_mtime_ns
            with Image.open(output) as decoded:
                self.assertEqual(decoded.size, (1333, 2000))
            media.generate(root)
            self.assertEqual(output.stat().st_mtime_ns, modified)
            self.assertEqual(source.read_bytes(), original)
            source.unlink()
            self.assertEqual(media.generate(root), {})
            self.assertFalse(output.exists())

    def test_transparency_and_animated_images(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            directory = root / 'images/notes'
            directory.mkdir(parents=True)
            Image.new('RGBA', (40, 20), (200, 100, 0, 0)).save(directory / 'alpha.png')
            first = Image.new('RGB', (40, 20), 'red')
            first.save(directory / 'animated.webp', save_all=True, append_images=[Image.new('RGB', (40, 20), 'blue')], duration=100, loop=0)
            palette = Image.new('P', (40, 20))
            palette.save(directory / 'palette.png', transparency=0)
            result = media.generate(root)
            self.assertNotIn('/images/notes/animated.webp', result)
            palette_output = root / result['/images/notes/palette.png']['src'].lstrip('/')
            with Image.open(palette_output) as decoded:
                self.assertEqual(decoded.getpixel((0, 0))[3], 0)
            output = root / result['/images/notes/alpha.png']['src'].lstrip('/')
            with Image.open(output) as decoded:
                self.assertEqual(decoded.getpixel((0, 0))[3], 0)


if __name__ == '__main__':
    unittest.main()
