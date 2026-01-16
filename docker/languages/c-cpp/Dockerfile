FROM gcc:13
LABEL cloudcodex=true

RUN useradd -m -s /bin/bash codeuser && \
    mkdir /code && \
    chown codeuser:codeuser /code

WORKDIR /code
USER codeuser

CMD ["bash"]
