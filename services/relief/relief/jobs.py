"""Durable job records with a bounded, single-engine execution queue."""
import json
import logging
import re
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

from .artifacts import write_artifacts
from .settings import ReliefSettings

log = logging.getLogger(__name__)
ID = re.compile(r'^[a-f0-9]{32}$')
ARTIFACTS = {'relief_16bit.png', 'relief_preview.png', 'mask_preview.png',
             'depth_preview.png', 'shaded_preview.png', 'relief_float.npy', 'metadata.json'}
SOURCE_FILES = {'source.png', 'raw_depth.npy', 'source_mask.npy'}
BUSY = {'queued', 'depth_inference', 'relief_processing'}


class QueueFull(ValueError): pass
class JobBusy(ValueError): pass


class Jobs:
    def __init__(self, root, engine, capacity=4):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.engine = engine
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='relief')
        self.slots = threading.BoundedSemaphore(capacity)
        self.lock = threading.RLock()
        for path in self.root.glob('*/status.json'):
            try:
                record = json.loads(path.read_text())
                if record['status'] in BUSY:
                    record.update(status='error', error='Processing was interrupted by a service restart. Generate again, or adjust the saved depth if available.')
                    self._save(record)
            except (ValueError, KeyError, OSError):
                log.exception('Could not recover %s', path)

    def close(self):
        self.executor.shutdown(wait=True)

    def folder(self, job_id):
        if not ID.fullmatch(job_id):
            raise FileNotFoundError('Job not found.')
        return self.root / job_id

    def _save(self, record):
        folder = self.folder(record['id'])
        temp = folder / 'status.tmp'
        temp.write_text(json.dumps(record, allow_nan=False) + '\n')
        temp.replace(folder / 'status.json')

    def get(self, job_id):
        with self.lock:
            record = json.loads((self.folder(job_id) / 'status.json').read_text())
            record['has_depth'] = (self.folder(job_id) / 'raw_depth.npy').exists()
            return record

    def update(self, job_id, **fields):
        with self.lock:
            record = self.get(job_id)
            record.update(fields)
            self._save(record)
            return record

    def create(self, image, mask, settings):
        if not self.slots.acquire(blocking=False):
            raise QueueFull('The relief queue is full. Wait for a job to finish.')
        job_id = uuid.uuid4().hex
        try:
            folder = self.folder(job_id)
            folder.mkdir()
            image.save(folder / 'source.png')
            np.save(folder / 'source_mask.npy', mask, allow_pickle=False)
            record = {'id': job_id, 'status': 'queued', 'version': 0, 'engine': self.engine.name,
                      'settings': settings.to_dict(), 'width': image.width, 'height': image.height,
                      'error': None}
            with self.lock:
                self._save(record)
            self.executor.submit(self._run, job_id, settings, True)
            return record
        except Exception:
            self.slots.release()
            raise

    def reprocess(self, job_id, settings):
        with self.lock:
            record = self.get(job_id)
            if record['status'] in BUSY:
                raise JobBusy('This job is still processing.')
            if not record['has_depth']:
                raise ValueError('This job has no saved depth. Generate depth again.')
            if not self.slots.acquire(blocking=False):
                raise QueueFull('The relief queue is full. Wait for a job to finish.')
            try:
                self.update(job_id, status='queued', error=None, settings=settings.to_dict())
                self.executor.submit(self._run, job_id, settings, False)
            except Exception:
                self.slots.release()
                raise
            return self.get(job_id)

    def _run(self, job_id, settings, inference):
        folder = self.folder(job_id)
        try:
            if inference:
                self.update(job_id, status='depth_inference')
                with Image.open(folder / 'source.png') as source:
                    depth = self.engine.predict(source.convert('RGB'))
                if depth.shape != (self.get(job_id)['height'], self.get(job_id)['width']):
                    raise ValueError('The engine returned unexpected depth dimensions.')
                np.save(folder / 'raw_depth.npy', depth, allow_pickle=False)
            else:
                depth = np.load(folder / 'raw_depth.npy', allow_pickle=False)
            self.update(job_id, status='relief_processing')
            mask = np.load(folder / 'source_mask.npy', allow_pickle=False)
            # A crash can publish a complete directory before status.json records it.
            published = [int(path.name) for path in folder.iterdir() if path.is_dir() and path.name.isdecimal()]
            version = max([self.get(job_id)['version'], *published]) + 1
            # Failed processing can leave this staging directory, but never publishes it.
            staging = folder / ('pending-' + uuid.uuid4().hex)
            write_artifacts(staging, depth, settings, mask, self.engine.name)
            staging.replace(folder / str(version))
            self.update(job_id, status='complete', version=version, error=None)
        except Exception as exc:
            log.exception('Relief job %s failed', job_id)
            if isinstance(exc, ValueError):
                message = str(exc)
            elif 'out of memory' in str(exc).lower():
                message = 'The GPU ran out of memory. Free GPU memory and generate again.'
            else:
                message = 'Relief generation failed. Check the service log, then try again.'
            self.update(job_id, status='error', error=message)
        finally:
            self.slots.release()

    def file(self, job_id, version, name):
        record = self.get(job_id)
        if version == 0 and name in SOURCE_FILES:
            path = self.folder(job_id) / name
        elif 1 <= version <= record['version'] and name in ARTIFACTS:
            path = self.folder(job_id) / str(version) / name
        else:
            raise FileNotFoundError('File not found.')
        if not path.is_file():
            raise FileNotFoundError('File not found.')
        return path
