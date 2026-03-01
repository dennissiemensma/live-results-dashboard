ARG PYTHON_VERSION="3.14"

FROM python:${PYTHON_VERSION}-slim-trixie AS claude-dev

WORKDIR /app

ARG CLAUDE_INSTALL_CHECKSUM="431889ac7d056f636aaf5b71524666d04c89c45560f80329940846479d484778"
ENV PATH="/root/.local/bin:${PATH}"

RUN apt-get update && apt-get install -y bash curl jq
RUN curl -fsSL https://claude.ai/install.sh -o /tmp/install.sh \
    && echo "${CLAUDE_INSTALL_CHECKSUM}  /tmp/install.sh" | sha256sum --check \
    && bash /tmp/install.sh \
    && rm /tmp/install.sh

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["sleep", "infinity"]
