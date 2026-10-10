FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Transcrição CPU, sem API de áudio paga. Download público, sem dados do usuário.
ARG WHISPER_MODEL=tiny
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('${WHISPER_MODEL}', device='cpu', compute_type='int8', download_root='/models')"
RUN useradd --uid 10001 --create-home tnn && mkdir /data /backups && chown tnn:tnn /data /backups
COPY tnn ./tnn
USER 10001:10001
CMD ["python", "-m", "tnn.web"]
