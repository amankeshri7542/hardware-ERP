FROM node:24.21.0-alpine AS frontend-build
RUN npm install --global npm@11.17.0
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:24.21.0-alpine AS backend
RUN npm install --global npm@11.17.0
ENV NODE_ENV=production
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node backend/ ./
COPY --chown=node:node db/ /app/db/
COPY --from=frontend-build --chown=node:node /app/frontend/dist /app/frontend/dist
RUN mkdir -p /app/backend/pdf-output /app/backend/purchase-invoices && chown node:node /app/backend/pdf-output /app/backend/purchase-invoices
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
CMD ["node", "server.js"]

FROM nginxinc/nginx-unprivileged:1.28-alpine AS web
COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html
COPY deploy/nginx-docker.conf /etc/nginx/conf.d/default.conf
USER 101
EXPOSE 8080 8443
