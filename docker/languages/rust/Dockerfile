FROM rust:1.75-slim
LABEL cloudcodex=true

RUN useradd -m -s /bin/bash codeuser && \
    mkdir /code && \
    chown codeuser:codeuser /code

WORKDIR /code
USER codeuser

CMD ["rustc", "--version"]
