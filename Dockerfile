# API LançAI. No Coolify, use Build Pack = Dockerfile (não Nixpacks).
# O Nixpacks baixa o nixpkgs do GitHub em todo cache miss e costuma cair com exit 255.
FROM node:20-bookworm-slim

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.27.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY modulos ./modulos
COPY pacotes ./pacotes

RUN pnpm install --frozen-lockfile
RUN pnpm build:api

ENV NODE_ENV=production
EXPOSE 3333

CMD ["pnpm", "start:api"]
