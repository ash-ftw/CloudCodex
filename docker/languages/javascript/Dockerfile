FROM node:20-alpine
LABEL cloudcodex=true

RUN adduser -D codeuser && \
    mkdir /code && \
    chown codeuser:codeuser /code

WORKDIR /code
USER codeuser

CMD ["node"]
