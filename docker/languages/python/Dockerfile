FROM python:3.11-slim
LABEL cloudcodex=true

RUN useradd -m -s /bin/bash codeuser && \
    mkdir /code && \
    chown codeuser:codeuser /code

WORKDIR /code
USER codeuser

CMD ["python3"]
