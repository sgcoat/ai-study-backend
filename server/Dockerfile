FROM node:24-bookworm-slim AS build

WORKDIR /app
RUN npm install --global pnpm@12.4.2

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

FROM node:24-bookworm-slim AS runtime

ARG VERSION=dev
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="AI Study Backend" \
      org.opencontainers.image.description="Passwordless authentication and AI study API" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}"

ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data \
    NODE_OPTIONS=--dns-result-order=ipv4first
WORKDIR /app
RUN install -d -o node -g node -m 0700 /data

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node --input-type=module -e "try { const r = await fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/health', { signal: AbortSignal.timeout(3000) }); if (!r.ok) process.exit(1); } catch { process.exit(1); }"
STOPSIGNAL SIGTERM
CMD ["node", "dist/index.js"]
