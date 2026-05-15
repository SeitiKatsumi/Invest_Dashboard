FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build

FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/package*.json ./

RUN npm ci --omit=dev \
  && npx playwright install --with-deps chromium \
  && npx playwright install chrome \
  && npm cache clean --force

EXPOSE 5000

CMD ["node", "dist/index.cjs"]
