# syntax=docker/dockerfile:1

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM base AS deps
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

FROM base AS production-deps
RUN pnpm install --prod --frozen-lockfile

FROM node:24-slim AS runtime
ENV NODE_ENV=production
ENV AGENT_HOST=0.0.0.0
ENV AGENT_PORT=3400
WORKDIR /app
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 3400
CMD ["node", "dist/index.js"]
