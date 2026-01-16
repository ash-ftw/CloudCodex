FROM alpine:3.19
LABEL cloudcodex=true

RUN apk add --no-cache bash && \
    adduser -D codeuser && \
    mkdir /code && \
    chown codeuser:codeuser /code

WORKDIR /code
USER codeuser

CMD ["bash"]
