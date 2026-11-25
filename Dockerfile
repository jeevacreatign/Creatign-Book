# Creatign Ledger: one container serves the React app and the API on port 4000.
# Build:  docker build -t creatign-ledger .
# Run:    docker run -p 4000:4000 -e DATABASE_URL=mysql://... creatign-ledger

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=4000 UPLOAD_DIR=/data/uploads
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data/uploads /app/server/data && chown -R node:node /data /app/server/data
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "server/index.ts"]
