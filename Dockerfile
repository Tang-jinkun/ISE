FROM node:22-alpine AS workspace
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY agent/package.json agent/package.json
COPY packages/agent-core/package.json packages/agent-core/package.json
COPY packages/runtime-contracts/package.json packages/runtime-contracts/package.json
COPY packages/skills-core/package.json packages/skills-core/package.json

RUN npm ci

COPY apps ./apps
COPY agent ./agent
COPY packages ./packages
COPY provenance ./provenance

FROM workspace AS api-build
RUN npm run prisma:generate -w @ise/api \
    && npm run build -w @ise/api

FROM api-build AS api
ENV NODE_ENV=production
WORKDIR /app/apps/api
RUN mkdir -p logs/errors logs/warnings logs/app /app/apps/raster_uploads \
    && chown -R node:node logs /app/apps/raster_uploads
USER node
EXPOSE 3333
CMD ["sh", "-c", "../../node_modules/.bin/prisma migrate deploy && node dist/main.js"]

FROM workspace AS agent
ENV NODE_ENV=production
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 4444
CMD ["node", "--import", "tsx", "agent/src/server.ts"]

FROM workspace AS web
ENV NODE_ENV=development
WORKDIR /app
USER node
EXPOSE 9999
CMD ["npm", "run", "dev", "-w", "@ise/web", "--", "--host", "0.0.0.0"]
