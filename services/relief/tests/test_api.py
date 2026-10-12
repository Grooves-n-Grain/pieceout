import io
import tempfile
import threading
import time
import unittest
from pathlib import Path
import numpy as np
from PIL import Image
from fastapi.testclient import TestClient
from relief.api import create_app
from pillow_heif import from_pillow


def source_bytes(size=(24, 36)):
    stream = io.BytesIO()
    Image.new('RGB', size, 'green').save(stream, format='PNG')
    return stream.getvalue()


class TestEngine:
    name = 'test-only'
    def __init__(self):
        self.calls = 0
        self.active = 0
        self.peak_active = 0
        self.warning = None
    def gpu_warning(self):
        return self.warning
    def predict(self, image):
        self.calls += 1
        self.active += 1
        self.peak_active = max(self.peak_active, self.active)
        time.sleep(0.015)
        self.active -= 1
        return np.linspace(1, 10, image.width * image.height, dtype=np.float32).reshape(image.height, image.width)


class APITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.engine = TestEngine()
        self.client = TestClient(create_app(Path(self.temp.name), self.engine))
        self.client.__enter__()
    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.temp.cleanup()
    def create(self):
        response = self.client.post('/api/relief/jobs', files={'image': ('test.png', source_bytes(), 'image/png')})
        self.assertEqual(response.status_code, 202, response.text)
        return response.json()['id']
    def wait(self, job):
        for _ in range(200):
            value = self.client.get(f'/api/relief/jobs/{job}').json()
            if value['status'] in {'complete', 'error'}:
                self.assertEqual(value['status'], 'complete', value)
                return value
            time.sleep(0.01)
        self.fail('Job did not finish')
    def test_reprocess_uses_cached_depth_and_keeps_old_export(self):
        job = self.create()
        value = self.wait(job)
        first = self.client.get(f'/api/relief/jobs/{job}/files/1/relief_16bit.png').content
        response = self.client.post(f'/api/relief/jobs/{job}/relief', json={'gamma': 2, 'depth_mm': 2})
        self.assertEqual(response.status_code, 202, response.text)
        value = self.wait(job)
        self.assertEqual(value['version'], 2)
        self.assertEqual(self.engine.calls, 1)
        second = self.client.get(f'/api/relief/jobs/{job}/files/2/relief_16bit.png').content
        self.assertNotEqual(first, second)
        self.assertEqual(first, self.client.get(f'/api/relief/jobs/{job}/files/1/relief_16bit.png').content)
        self.assertEqual(self.client.get(f'/api/relief/jobs/{job}/files/0/status.json').status_code, 404)
    def test_health_reports_a_lost_gpu(self):
        self.assertIsNone(self.client.get('/api/relief/health').json()['gpu_warning'])
        self.engine.warning = 'GPU lost.'
        self.assertEqual(self.client.get('/api/relief/health').json()['gpu_warning'], 'GPU lost.')

    def test_jobs_serialize(self):
        jobs = [self.create() for _ in range(3)]
        for job in jobs: self.wait(job)
        self.assertEqual(self.engine.calls, 3)
        self.assertEqual(self.engine.peak_active, 1)

    def test_mode_and_model_switches_reuse_the_correct_cached_depth(self):
        job = self.create()
        self.wait(job)
        original = self.client.get(f'/api/relief/jobs/{job}/files/0/raw_depth.npy').content
        for controls, expected_calls in [({'mode': 'raised'}, 1),
                                         ({'depth_model': 'depth-anything-v2-small'}, 2),
                                         ({'depth_model': 'patchfusion-vitb'}, 2),
                                         ({'depth_model': 'depth-anything-v2-small'}, 2)]:
            response = self.client.post(f'/api/relief/jobs/{job}/relief', json=controls)
            self.assertEqual(response.status_code, 202, response.text)
            record = self.wait(job)
            self.assertEqual(self.engine.calls, expected_calls)
            self.assertEqual(record['settings']['mode'], 'raised')
            self.assertEqual(record['depth_model'], record['settings']['depth_model'])
            preview = self.client.get(f"/api/relief/jobs/{job}/files/{record['version']}/surface_preview.json")
            self.assertEqual(preview.status_code, 200)
            self.assertEqual(len(preview.json()['surface']), 24 * 36)
        self.assertEqual(original, self.client.get(f'/api/relief/jobs/{job}/files/0/raw_depth.npy').content)

    def test_legacy_version_has_3d_preview_without_reprocessing(self):
        job = self.create()
        self.wait(job)
        (Path(self.temp.name) / job / '1/surface_preview.json').unlink()
        response = self.client.get(f'/api/relief/jobs/{job}/files/1/surface_preview.json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.engine.calls, 1)
        self.assertEqual(self.client.get(f'/api/relief/jobs/{job}/files/2/surface_preview.json').status_code, 404)

    def test_cached_exports_keep_original_engine_provenance(self):
        self.engine.gpu_note = 'Made room.'
        job = self.create()
        self.assertEqual(self.wait(job)['gpu_note'], 'Made room.')
        self.engine.name = 'another-resident-model'
        self.engine.gpu_note = None
        self.client.post(f'/api/relief/jobs/{job}/relief', json={'mode': 'raised'})
        record = self.wait(job)
        self.assertEqual(record['engine'], 'test-only')
        self.assertEqual(record['gpu_note'], 'Made room.')
        metadata = self.client.get(f"/api/relief/jobs/{job}/files/{record['version']}/metadata.json").json()
        self.assertEqual(metadata['engine'], 'test-only')

    def test_model_switch_after_first_processing_failure_runs_requested_model(self):
        import json
        calls = []
        def predict_for(image, model):
            calls.append(model)
            self.engine.name = model
            return self.engine.predict(image)
        self.engine.predict_for = predict_for
        response = self.client.post('/api/relief/jobs',
            files={'image': ('small.png', source_bytes((5, 5)), 'image/png')},
            data={'settings': json.dumps({'depth_model': 'depth-anything-v2-small', 'background_threshold': 0.001})})
        self.assertEqual(response.status_code, 202, response.text)
        job = response.json()['id']
        for _ in range(200):
            record = self.client.get(f'/api/relief/jobs/{job}').json()
            if record['status'] == 'error': break
            time.sleep(0.01)
        self.assertEqual(record['status'], 'error')
        response = self.client.post(f'/api/relief/jobs/{job}/relief',
                                   json={'depth_model': 'patchfusion-vitb', 'background_threshold': 1})
        self.assertEqual(response.status_code, 202, response.text)
        record = self.wait(job)
        self.assertEqual(calls, ['depth-anything-v2-small', 'patchfusion-vitb'])
        self.assertEqual(record['engine'], 'patchfusion-vitb')

    def test_legacy_depth_is_cached_before_switching_models(self):
        import json
        job = self.create()
        self.wait(job)
        path = Path(self.temp.name) / job / 'status.json'
        record = json.loads(path.read_text())
        record.pop('depth_cache')
        record.pop('depth_model')
        record['settings'].pop('depth_model')
        record['settings'].pop('mode')
        path.write_text(json.dumps(record))
        for model in ['depth-anything-v2-small', 'patchfusion-vitb']:
            self.client.post(f'/api/relief/jobs/{job}/relief', json={'depth_model': model})
            self.wait(job)
        self.assertEqual(self.engine.calls, 2)
    def test_upload_validation(self):
        response = self.client.post('/api/relief/jobs', files={'image': ('fake.png', b'not an image', 'image/png')})
        self.assertEqual(response.status_code, 422)
        response = self.client.post('/api/relief/jobs', files={'image': ('x.png', source_bytes()), 'mask': ('m.png', source_bytes((3, 3)))})
        self.assertEqual(response.status_code, 422)

    def test_heif_preview_and_generation_accept_original_bytes(self):
        output = io.BytesIO()
        from_pillow(Image.new('RGB', (24, 36), 'green')).save(output)
        # The bytes decide the format, even if the browser reports JPEG.
        files = {'image': ('photo.jpg', output.getvalue(), 'image/jpeg')}
        preview = self.client.post('/api/relief/images/preview', files=files)
        self.assertEqual(preview.status_code, 200, preview.text[:100])
        self.assertEqual(preview.headers['content-type'], 'image/png')
        with Image.open(io.BytesIO(preview.content)) as image:
            self.assertEqual(image.size, (24, 36))
        self.assertEqual(self.engine.calls, 0)
        self.assertEqual(list(Path(self.temp.name).iterdir()), [])
        response = self.client.post('/api/relief/jobs', files=files)
        self.assertEqual(response.status_code, 202, response.text)
        self.wait(response.json()['id'])

    def test_preview_is_bounded_and_preserves_alpha(self):
        output = io.BytesIO()
        Image.new('RGBA', (1000, 2000), (0, 255, 0, 100)).save(output, format='PNG')
        response = self.client.post('/api/relief/images/preview', files={'image': ('x.png', output.getvalue())})
        self.assertEqual(response.status_code, 200)
        with Image.open(io.BytesIO(response.content)) as image:
            self.assertEqual(image.size, (960, 1920))
            self.assertEqual(image.getpixel((0, 0))[3], 100)

    def test_preview_rejects_bad_or_oversized_files(self):
        for data, expected in [(b'not an image', 422), (b'x' * (20 * 1024 * 1024 + 65537), 413)]:
            with self.subTest(expected=expected):
                response = self.client.post('/api/relief/images/preview', files={'image': ('x.heic', data)})
                self.assertEqual(response.status_code, expected)

    def test_corrupt_heif_payload_returns_validation_error(self):
        data = (Path(__file__).parent / 'fixtures/damaged-payload.heic').read_bytes()
        for endpoint in ('/api/relief/images/preview', '/api/relief/jobs'):
            with self.subTest(endpoint=endpoint):
                response = self.client.post(endpoint, files={'image': ('damaged.heic', data, 'image/heic')})
                self.assertEqual(response.status_code, 422)
                self.assertIn('HEIC/HEIF', response.json()['detail'])
                self.assertIn('damaged or incomplete', response.json()['detail'])

    def test_invalid_controls_are_not_queued(self):
        job = self.create()
        self.wait(job)
        response = self.client.post(f'/api/relief/jobs/{job}/relief', json={'gamma': 0})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.client.get(f'/api/relief/jobs/{job}').json()['version'], 1)
    def test_unknown_jobs_and_traversal(self):
        self.assertEqual(self.client.get('/api/relief/jobs/unknown').status_code, 404)
        self.assertEqual(self.client.get('/api/relief/jobs/..%2Fprivate').status_code, 404)
    def test_reload_preserves_completed_job(self):
        job = self.create()
        value = self.wait(job)
        with TestClient(create_app(Path(self.temp.name), TestEngine())) as restarted:
            self.assertEqual(restarted.get(f'/api/relief/jobs/{job}').json()['version'], value['version'])

    def test_restart_recovers_after_output_published_before_status(self):
        import json
        from relief.jobs import Jobs
        job = self.create()
        self.wait(job)
        status_path = Path(self.temp.name) / job / 'status.json'
        record = json.loads(status_path.read_text())
        record.update(status='relief_processing', version=0)
        status_path.write_text(json.dumps(record))
        with TestClient(create_app(Path(self.temp.name), TestEngine())) as restarted:
            response = restarted.post(f'/api/relief/jobs/{job}/relief', json={'gamma': 1.5})
            self.assertEqual(response.status_code, 202)
            for _ in range(100):
                record = restarted.get(f'/api/relief/jobs/{job}').json()
                if record['status'] in {'complete', 'error'}: break
                time.sleep(0.01)
            self.assertEqual(record['status'], 'complete', record)
            self.assertGreater(record['version'], 1)

    def test_request_body_is_bounded_before_json_parsing(self):
        response = self.client.post('/api/relief/jobs/' + 'a' * 32 + '/relief', content=b'x' * 65537,
                                    headers={'content-type': 'application/json'})
        self.assertEqual(response.status_code, 413)

    def test_queue_has_a_fixed_capacity(self):
        from relief.jobs import Jobs, QueueFull
        entered, release = threading.Event(), threading.Event()
        class BlockingEngine(TestEngine):
            def predict(self, image):
                entered.set()
                if not release.wait(5): raise RuntimeError('Test gate timed out')
                return super().predict(image)
        with tempfile.TemporaryDirectory() as folder:
            jobs = Jobs(folder, BlockingEngine(), capacity=2)
            try:
                from relief.settings import ReliefSettings
                image = Image.new('RGB', (24, 36))
                mask = np.ones((36, 24), dtype=np.float32)
                jobs.create(image, mask, ReliefSettings())
                self.assertTrue(entered.wait(2))
                jobs.create(image, mask, ReliefSettings())
                with self.assertRaises(QueueFull): jobs.create(image, mask, ReliefSettings())
            finally:
                release.set()
                jobs.close()
