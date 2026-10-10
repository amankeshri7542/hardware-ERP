FROM node:24.21.0-alpine
WORKDIR /renderer
COPY renderer/package.json renderer/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY renderer/*.cjs ./
COPY renderer/fonts ./fonts
COPY scripts/local-only-network.cjs ./local-only-network.cjs
ENV NODE_OPTIONS=--require=/renderer/local-only-network.cjs
USER 65532:65532
CMD ["node", "--max-old-space-size=96", "cli.cjs"]
