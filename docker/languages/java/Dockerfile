FROM eclipse-temurin:17-jdk

LABEL cloudcodex=true

RUN adduser --disabled-password --gecos "" codeuser && \
    mkdir -p /code && \
    chown -R codeuser:codeuser /code

WORKDIR /code

USER codeuser

CMD ["jshell"]