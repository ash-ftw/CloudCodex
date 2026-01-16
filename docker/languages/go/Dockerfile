FROM golang:1.22-alpine
LABEL cloudcodex=true

RUN adduser -D codeuser && \
    mkdir /code && \
    chown codeuser:codeuser /code

WORKDIR /code
USER codeuser

CMD ["go", "version"]
