FROM node:20-alpine

# Install git and ssh
RUN apk add --no-cache git openssh-client

# Create working directory
WORKDIR /app

# Copy worker files
COPY package.json ./
RUN npm install --production

COPY worker.js ./

# Create workspace directory
RUN mkdir -p /workspace

# Run as non-root user for security
RUN adduser -D -u 1001 gitworker && \
    chown -R gitworker:gitworker /app /workspace

USER gitworker

# Git config defaults
RUN git config --global init.defaultBranch main && \
    git config --global user.email "cloudcodex@local" && \
    git config --global user.name "CloudCodeX User"

ENTRYPOINT ["node", "/app/worker.js"]
