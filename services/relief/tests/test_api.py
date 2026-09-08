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
    def test_jobs_serialize(self):
        jobs = [self.create() for _ in range(3)]
        for job in jobs: self.wait(job)
        self.assertEqual(self.engine.calls, 3)
        self.assertEqual(self.engine.peak_active, 1)
    def test_upload_validation(self):
        response = self.client.post('/api/relief/jobs', files={'image': ('fake.png', b'not an image', 'image/png')})
        self.assertEqual(response.status_code, 422)
        response = self.client.post('/api/relief/jobs', files={'image': ('x.png', source_bytes()), 'mask': ('m.png', source_bytes((3, 3)))})
        self.assertEqual(response.status_code, 422)
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
