FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY radar-viral/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10002 --create-home radar
# Bibliotecas de rede/cotas do jornal copiadas, sem alterar o serviço de redação.
COPY --chown=radar:radar news-agent/tnn ./tnn
COPY --chown=radar:radar radar-viral/tnn_viral ./tnn_viral
USER radar
CMD ["python","-m","tnn_viral.worker"]
