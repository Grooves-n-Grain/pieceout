"""Optional local relief API. Run one Uvicorn process per GPU service."""
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from starlette.concurrency import run_in_threadpool

from .engines.patchfusion import PatchFusionEngine
from .images import MAX_UPLOAD_BYTES, prepare_image
from .jobs import Jobs, JobBusy, QueueFull
from .settings import ReliefSettings


class UploadLimit:
    """Bound the entire request before multipart parsing, including chunked uploads."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope['method'] not in {'POST', 'PUT', 'PATCH'}:
            return await self.app(scope, receive, send)
        limit = 2 * MAX_UPLOAD_BYTES + 65536 if scope['path'].endswith('/jobs') else 65536
        chunks = []
        size = 0
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect':
                return
            chunk = message.get('body', b'')
            size += len(chunk)
            if size > limit:
                response = JSONResponse({'detail': 'Upload is too large. Each image must be at most 20 MB.'}, status_code=413)
                return await response(scope, receive, send)
            chunks.append(chunk)
            if not message.get('more_body'):
                break
        body = b''.join(chunks)
        delivered = False
        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {'type': 'http.request', 'body': body, 'more_body': False}
            return await receive()
        await self.app(scope, replay, send)


def create_app(data_dir=None, engine=None):
    @asynccontextmanager
    async def lifespan(app):
        app.state.jobs = Jobs(data_dir or os.environ.get('RELIEF_DATA_DIR', str(Path.home() / '.local/share/pieceout/relief')), engine or PatchFusionEngine())
        yield
        await run_in_threadpool(app.state.jobs.close)

    app = FastAPI(title='PieceOut Relief', lifespan=lifespan, docs_url=None, redoc_url=None)
    app.add_middleware(UploadLimit)

    @app.exception_handler(FileNotFoundError)
    async def missing(request, exc):
        return JSONResponse({'detail': 'Job or file not found.'}, status_code=404)

    @app.exception_handler(ValueError)
    async def invalid(request, exc):
        status = 429 if isinstance(exc, QueueFull) else 409 if isinstance(exc, JobBusy) else 422
        return JSONResponse({'detail': str(exc)}, status_code=status)

    @app.get('/api/relief/health')
    def health():
        return {'status': 'ready', 'engine': app.state.jobs.engine.name}

    @app.post('/api/relief/jobs', status_code=202)
    async def create(request: Request):
        async with request.form(max_files=2, max_fields=1) as form:
            image = form.get('image')
            mask = form.get('mask')
            if image is None or not hasattr(image, 'read') or (mask is not None and not hasattr(mask, 'read')):
                raise ValueError('Choose an image and an optional image mask.')
            image_data = await image.read(MAX_UPLOAD_BYTES + 1)
            mask_data = await mask.read(MAX_UPLOAD_BYTES + 1) if mask else None
            try:
                controls = json.loads(form.get('settings', '{}'))
                if not isinstance(controls, dict):
                    raise ValueError('Settings must be an object.')
                settings = ReliefSettings(**controls)
            except TypeError as exc:
                raise ValueError('Unknown relief setting.') from exc
            rgb, coverage = await run_in_threadpool(prepare_image, image_data, mask_data)
            return await run_in_threadpool(app.state.jobs.create, rgb, coverage, settings)

    @app.get('/api/relief/jobs/{job_id}')
    def status(job_id: str):
        return app.state.jobs.get(job_id)

    @app.post('/api/relief/jobs/{job_id}/relief', status_code=202)
    async def reprocess(job_id: str, request: Request):
        controls = await request.json()
        if not isinstance(controls, dict):
            raise ValueError('Settings must be an object.')
        try:
            # Partial updates retain the job's dimensions and previously chosen controls.
            settings = ReliefSettings(**(app.state.jobs.get(job_id)['settings'] | controls))
        except TypeError as exc:
            raise ValueError('Unknown relief setting.') from exc
        return app.state.jobs.reprocess(job_id, settings)

    @app.get('/api/relief/jobs/{job_id}/files/{version}/{name}')
    def download(job_id: str, version: int, name: str):
        path = app.state.jobs.file(job_id, version, name)
        return FileResponse(path, headers={'Cache-Control': 'private, max-age=31536000, immutable'})

    return app


app = create_app()
