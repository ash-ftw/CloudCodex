FROM ruby:3.3-alpine
LABEL cloudcodex=true

RUN adduser -D codeuser && \
    mkdir /code && \
    chown codeuser:codeuser /code

WORKDIR /code
USER codeuser

CMD ["ruby", "-v"]
