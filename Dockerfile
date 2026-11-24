# Sandbox image for Puppetainer: the agent runs commands in it via `docker exec`.
FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash ca-certificates coreutils curl git less procps python3 jq \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /bin/bash puppet
USER puppet
WORKDIR /home/puppet

# Stay alive so commands can be run with `docker exec`.
CMD ["sleep", "infinity"]
