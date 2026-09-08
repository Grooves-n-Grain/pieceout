import io
import unittest
import numpy as np
from PIL import Image
from relief.images import prepare_image


def png(image):
    output = io.BytesIO()
    image.save(output, format='PNG')
    return output.getvalue()


class ImageTests(unittest.TestCase):
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
