FROM python:3.12-slim
WORKDIR /app

ARG INSTALL_FFMPEG=false
# fonts-noto-cjk 所有 worker 都要（image.text 中文压字）；ffmpeg 仅视频/合成 worker。
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; \
    apt-get update && \
    if [ "$INSTALL_FFMPEG" = "true" ]; then apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk; \
    else apt-get install -y --no-install-recommends fonts-noto-cjk; fi && \
    rm -rf /var/lib/apt/lists/*
# pypi.org unreachable from some build environments; default to a mirror (override with --build-arg)
ARG UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
RUN pip install --no-cache-dir -i ${UV_INDEX_URL} uv
ENV UV_INDEX_URL=${UV_INDEX_URL}

COPY workers/image/pyproject.toml ./workers/image/
RUN cd workers/image && uv pip install --system -e .
# pipeline worker 需要 Agent 框架依赖（langchain/moviepy…），按构建参数可选安装
ARG INSTALL_VIMAX_AGENTS=false
RUN if [ "$INSTALL_VIMAX_AGENTS" = "true" ]; then       cd workers/image && uv pip install --system -e ".[vimax-agents]" &&       uv pip uninstall --system opencv-python opencv-python-headless &&       uv pip install --system opencv-python-headless;     fi

COPY workers/image/vimax_image_worker ./workers/image/vimax_image_worker

ENV PYTHONPATH=/app/vimax:/app/workers/image
ENV VIMAX_ROOT=/app/vimax

CMD ["python", "-m", "vimax_image_worker.main"]
