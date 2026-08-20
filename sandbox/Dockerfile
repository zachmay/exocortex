# Exocortex sandbox template image.
# Extends the official Claude Code sbx base.
# Build from this directory: `docker build -t exocortex-sbx System/Agent/Sandbox`
FROM docker/sandbox-templates:claude-code

USER root

# Skip *automatic* browser downloads during package installs. We get our
# Chromium explicitly later via `playwright install chromium`, so neither
# Playwright nor Puppeteer should fetch a duplicate copy.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers

# System packages:
#  - fonts-liberation: glyph coverage for headless PDF rendering
#  - python3-venv, python3-pip: needed for the venv install step
# NOTE: we deliberately do NOT install apt's chromium-browser package. On
# Ubuntu 25.10 it's a snap-launcher stub that exits 1 in containers.
# Playwright's chromium (installed below) is the real binary.
RUN apt-get update && apt-get install -y --no-install-recommends \
      fonts-liberation \
      python3-venv \
      python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Node dependencies — installed into a fixed image path outside the workspace
# so node_modules never lands in the Obsidian vault.
RUN corepack enable
WORKDIR /opt/vault-deps
COPY package.json package-lock.json ./
RUN npm ci

# Python dependencies — installed into a venv at the same prefix.
# requirements.lock.txt is the full pip-frozen transitive closure (use that
# for deterministic builds). requirements.txt is the human-readable list to
# edit when adding/removing deps — regenerate the lockfile after.
COPY requirements.txt requirements.lock.txt ./
RUN python3 -m venv venv \
    && venv/bin/pip install --no-cache-dir --upgrade pip \
    && venv/bin/pip install --no-cache-dir -r requirements.lock.txt

# Install Chromium system deps manually using the ubuntu24.04 package list, which
# works on ubuntu26.04. Remove this block and restore --with-deps once playwright>=1.61
# is on PyPI (it adds native ubuntu26.04 support).
RUN apt-get update && apt-get install -y --no-install-recommends \
      libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 \
      libcairo2 libcups2t64 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 \
      libnspr4 libnss3 libpango-1.0-0 libwayland-client0 \
      libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 \
      libxkbcommon0 libxrandr2 \
    && rm -rf /var/lib/apt/lists/*

# Playwright 1.60.0 hard-blocks on ubuntu26.04 before even downloading the binary.
# Temporarily spoof VERSION_ID so it sees ubuntu24.04, then restore.
# Remove the sed lines (and the apt block above) once playwright>=1.61 is on PyPI.
RUN sed -i 's/^VERSION_ID="26\.04"/VERSION_ID="24.04"/' /etc/os-release \
    && venv/bin/playwright install chromium \
    && sed -i 's/^VERSION_ID="24\.04"/VERSION_ID="26.04"/' /etc/os-release

# Symlink to a stable path so puppeteer-core (md-to-pdf, mermaid-cli) and
# any future tool can find it via PUPPETEER_EXECUTABLE_PATH below.
RUN ln -sf "$(find /opt/playwright-browsers -name headless_shell -type f -executable | head -1)" /usr/local/bin/chromium-headless \
    && ln -sf "$(find /opt/playwright-browsers -path '*/chrome-linux/chrome' -type f -executable | head -1)" /usr/local/bin/chromium \
    && /usr/local/bin/chromium --version

# Lock the whole prefix read-only so the agent can't mutate baked deps.
RUN chmod -R a-w /opt/vault-deps /opt/playwright-browsers

# Kit-authored CLAUDE.md/settings.json/TOOLCHAIN.md — baked in at build time
# rather than copied at sandbox-create time, since they're static per-image,
# not per-sandbox-instance state. Placed late so editing them doesn't bust the
# expensive layers above.
RUN mkdir -p /home/agent/.claude
COPY kit/files/home/claude/ /home/agent/.claude/
RUN chown -R agent:agent /home/agent/.claude

ENV PATH=/opt/vault-deps/venv/bin:/opt/vault-deps/node_modules/.bin:$PATH \
    NODE_PATH=/opt/vault-deps/node_modules \
    PUPPETEER_EXECUTABLE_PATH=/usr/local/bin/chromium \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/local/bin/chromium
