FROM php:8.3-cli-alpine
LABEL cloudcodex=true

RUN adduser -D codeuser && \
    mkdir /code && \
    chown codeuser:codeuser /code

WORKDIR /code
USER codeuser

CMD ["php", "-v"]
