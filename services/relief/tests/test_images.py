import io
import unittest
from unittest.mock import patch
import numpy as np
from PIL import Image
from pillow_heif import from_pillow
from relief.images import decode_image, prepare_image


def png(image):
    output = io.BytesIO()
    image.save(output, format='PNG')
    return output.getvalue()


class ImageTests(unittest.TestCase):
    def test_heif_decodes_and_preserves_portrait_shape(self):
        output = io.BytesIO()
        from_pillow(Image.new('RGB', (24, 36), (0, 255, 0))).save(output, quality=100)
        rgb, coverage = prepare_image(output.getvalue())
        self.assertEqual(rgb.size, (24, 36))
        self.assertGreater(rgb.getpixel((12, 18))[1], 240)
        self.assertTrue(np.all(coverage == 1))

    def test_heif_obeys_pixel_limit(self):
        output = io.BytesIO()
        from_pillow(Image.new('RGB', (24, 36))).save(output)
        with patch('relief.images.MAX_PIXELS', 800):
            with self.assertRaisesRegex(ValueError, '16 million pixels'):
                decode_image(output.getvalue())

    def test_camera_orientation_is_applied_once(self):
        image = Image.new('RGB', (24, 36))
        image.paste((255, 0, 0), (0, 0, 24, 18))
        exif = Image.Exif()
        exif[274] = 6
        for format in ('JPEG', 'HEIF'):
            with self.subTest(format=format):
                output = io.BytesIO()
                if format == 'HEIF':
                    from_pillow(image).save(output, quality=100, exif=exif.tobytes())
                else:
                    image.save(output, format=format, exif=exif)
                decoded = decode_image(output.getvalue())
                self.assertEqual(decoded.size, (36, 24))
                self.assertIn(decoded.getexif().get(274), (None, 1))
                self.assertGreater(decoded.getpixel((27, 12))[0], 240)
                self.assertLess(decoded.getpixel((9, 12))[0], 15)

    def test_unsupported_format_is_named(self):
        output = io.BytesIO()
        Image.new('RGB', (24, 36)).save(output, format='GIF')
        with self.assertRaisesRegex(ValueError, 'GIF.*not supported.*HEIC'):
            decode_image(output.getvalue())

    def test_damaged_heif_has_an_actionable_error(self):
        output = io.BytesIO()
        from_pillow(Image.new('RGB', (24, 36))).save(output)
        with self.assertRaisesRegex(ValueError, 'HEIC/HEIF.*damaged or incomplete'):
            decode_image(output.getvalue()[:64])

    def test_transparency_protects_the_face(self):
        image = Image.new('RGBA', (12, 16), (0, 255, 0, 0))
        image.paste((0, 255, 0, 255), (3, 4, 9, 12))
        rgb, coverage = prepare_image(png(image))
        self.assertEqual(rgb.size, (12, 16))
        self.assertTrue(np.all(coverage[:4] == 0))
        self.assertTrue(np.all(coverage[4:12, 3:9] == 1))
        self.assertEqual(rgb.getpixel((0, 0)), (255, 255, 255))

    def test_aspect_ratio_and_mask_alignment_survive_resize(self):
        image = Image.new('RGBA', (1000, 2000), (0, 255, 0, 255))
        mask = Image.new('L', image.size, 0)
        mask.paste(255, (0, 0, 1000, 1000))
        rgb, coverage = prepare_image(png(image), png(mask))
        self.assertEqual(rgb.size, (960, 1920))
        self.assertTrue(np.all(coverage[:950] == 1))
        self.assertTrue(np.all(coverage[970:] == 0))

    def test_empty_alpha_and_excessive_dimensions_are_rejected(self):
        for image in [Image.new('RGBA', (10, 10)), Image.new('L', (4001, 4000))]:
            with self.subTest(size=image.size), self.assertRaises(ValueError):
                prepare_image(png(image))
