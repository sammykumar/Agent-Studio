FROM archlinux:latest AS runtime-base

RUN pacman -Syu --noconfirm \
  ca-certificates \
  github-cli \
  git \
  openssh \
  python \
  nodejs \
  npm  \
  base-devel && \
  pacman -Scc --noconfirm

FROM runtime-base AS build-deps

WORKDIR /build

COPY package.json package-lock.json ./

RUN ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install

FROM build-deps AS agent-studio-build

COPY . .

RUN npm run npm:prepack

FROM runtime-base AS production-deps

WORKDIR /build

COPY package.json package-lock.json ./

# Only this production dependency tree is copied into the final image.
RUN npm install --omit=dev

FROM runtime-base AS runtime

RUN useradd -m -s /bin/bash agent-studio && \
  mkdir -p /opt/agent-studio /home/agent-studio/.npm-global /home/agent-studio/.local /home/agent-studio/.config /home/agent-studio/.ssh /home/agent-studio/go && \
  chown -R agent-studio:agent-studio /home/agent-studio

WORKDIR /opt/agent-studio

COPY --from=production-deps /build/node_modules ./node_modules
COPY --from=agent-studio-build /build/package.json ./package.json
COPY --from=agent-studio-build /build/next.config.mjs ./next.config.mjs
COPY --from=agent-studio-build /build/bin ./bin
COPY --from=agent-studio-build /build/dist-server ./dist-server
COPY --from=agent-studio-build /build/.next ./.next
COPY --from=agent-studio-build /build/public ./public
COPY --from=agent-studio-build /build/assets ./assets

RUN chmod +x /opt/agent-studio/bin/agent-studio.mjs && \
  chown -R root:root /opt/agent-studio

ENV NPM_CONFIG_PREFIX=/home/agent-studio/.npm-global
ENV PATH=/home/agent-studio/.bun/bin:/home/agent-studio/go/bin:${NPM_CONFIG_PREFIX}/bin:${PATH}

USER agent-studio

RUN npm config set prefix /home/agent-studio/.npm-global && \
  npm i -g \
  @openai/codex@latest \
  opencode-ai@latest

WORKDIR /home/agent-studio/workspaces

EXPOSE 32123

ENTRYPOINT ["node", "/opt/agent-studio/bin/agent-studio.mjs"]
