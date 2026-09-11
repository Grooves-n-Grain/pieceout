# HEIC regression fixture

`damaged-payload.heic` is synthetic noise, with a valid header and damaged compressed image data. It exercises decoder `EOFError` handling after header parsing. No user photo is included.

Created with Pillow 11.3.0 / pillow-heif 1.1.1:

```python
image = Image.fromarray(np.random.default_rng(7).integers(0, 256, (64, 64, 3), dtype=np.uint8))
output = io.BytesIO()
from_pillow(image).save(output, quality=80)
data = bytearray(output.getvalue())
data[361] = 48  # originally 237; corrupt the payload
```
