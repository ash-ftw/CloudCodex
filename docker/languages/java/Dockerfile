FROM eclipse-temurin:17-jdk-alpine
LABEL cloudcodex=true

RUN adduser -D codeuser && \
    mkdir /code && \
    chown codeuser:codeuser /code

WORKDIR /code
USER codeuser

CMD ["jshell"]
