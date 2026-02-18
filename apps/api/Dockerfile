# Build stage
FROM node:20-alpine AS builder
RUN npm install -g pnpm

WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --frozen-lockfile

COPY packages/shared/ ./packages/shared/
COPY apps/api/ ./apps/api/

RUN pnpm --filter @til-stack/shared build
RUN pnpm --filter @til-stack/api build

# Production stage
FROM node:20-alpine
WORKDIR /app

# Copy compiled code
COPY --from=builder /app/apps/api/dist ./dist

# Copy drizzle migration files (CRITICAL: needed for runtime migrations)
COPY --from=builder /app/apps/api/drizzle ./drizzle

# Copy package files
COPY --from=builder /app/apps/api/package.json ./
COPY --from=builder /app/packages/shared/dist ./node_modules/@til-stack/shared/dist
COPY --from=builder /app/packages/shared/package.json ./node_modules/@til-stack/shared/

RUN npm install --omit=dev --ignore-scripts

# Copy entrypoint script
COPY apps/api/entrypoint.sh ./
RUN chmod +x entrypoint.sh

ENV NODE_ENV=production
EXPOSE 3001
CMD ["./entrypoint.sh"]
