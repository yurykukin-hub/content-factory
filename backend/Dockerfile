FROM oven/bun:1-alpine

RUN apk add --no-cache vips-dev

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY prisma ./prisma/
RUN bunx prisma generate

COPY src ./src/

EXPOSE 3800

CMD ["bun", "src/index.ts"]
