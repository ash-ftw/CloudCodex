#!/usr/bin/env bash
set -euo pipefail

echo "Building CloudCodeX Docker images..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

declare -a IMAGES=(
  "cloudcodex-python:./languages/python"
  "cloudcodex-c-cpp:./languages/c-cpp"
  "cloudcodex-javascript:./languages/javascript"
  "cloudcodex-java:./languages/java"
  "cloudcodex-go:./languages/go"
  "cloudcodex-rust:./languages/rust"
  "cloudcodex-php:./languages/php"
  "cloudcodex-ruby:./languages/ruby"
  "cloudcodex-bash:./languages/bash"
  "cloudcodex-git-worker:./languages/git-worker"
)

failed=()

for entry in "${IMAGES[@]}"; do
  name="${entry%%:*}"
  path="${entry#*:}"

  echo
  echo "Building ${name}..."
  if ! docker build -t "$name" "$path"; then
    echo "Failed to build ${name}"
    failed+=("$name")
  else
    echo "Successfully built ${name}"
  fi
done

echo
echo "========================================"
if [ ${#failed[@]} -eq 0 ]; then
  echo "All images built successfully!"
else
  echo "Failed to build: ${failed[*]}"
  exit 1
fi
