FROM pytorch/pytorch:2.1.2-cuda11.8-cudnn8-runtime@sha256:971fbeae82c0a5a7a970a264a8b8ce1c3426aa79df7111004ad2bc2640f7d89c
ARG PATCHFUSION_REV=ab6814fe52d99cec7f0ac831fb3a8bfd4e8b7ff8
RUN apt-get update && apt-get install -y --no-install-recommends git libglib2.0-0 libgl1 && rm -rf /var/lib/apt/lists/*
RUN git init /opt/PatchFusion && cd /opt/PatchFusion && git remote add origin https://github.com/zhyever/PatchFusion.git && git fetch --depth 1 origin ${PATCHFUSION_REV} && git checkout --detach FETCH_HEAD
COPY requirements*.txt /opt/pieceout/
RUN pip install --no-cache-dir -r /opt/pieceout/requirements.txt -r /opt/pieceout/requirements-gpu.txt
COPY relief /opt/pieceout/relief
ENV PYTHONPATH=/opt/pieceout:/opt/PatchFusion:/opt/PatchFusion/external \
    HF_HOME=/models/huggingface TORCH_HOME=/models/torch \
    RELIEF_DATA_DIR=/data PYTHONUNBUFFERED=1 OMP_NUM_THREADS=4
WORKDIR /opt/PatchFusion
EXPOSE 8766
CMD ["python", "-m", "uvicorn", "relief.api:app", "--host", "0.0.0.0", "--port", "8766"]
