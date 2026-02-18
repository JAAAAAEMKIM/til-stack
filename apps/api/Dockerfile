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

# Create production deployment (resolves workspace: dependencies)
RUN pnpm --filter @til-stack/api deploy --prod /app/prod

# Production stage
FROM node:20-alpine
WORKDIR /app

# Copy production deployment (includes node_modules with resolved dependencies)
COPY --from=builder /app/prod ./

# Copy drizzle migration files (CRITICAL: needed for runtime migrations)
COPY --from=builder /app/apps/api/drizzle ./drizzle

# Copy entrypoint script
COPY apps/api/entrypoint.sh ./
RUN chmod +x entrypoint.sh

ENV NODE_ENV=production
EXPOSE 3001
CMD ["./entrypoint.sh"]
