FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
COPY apps/server/package*.json ./apps/server/
COPY apps/server/web/package*.json ./apps/server/web/

# Install all dependencies (allow optional for platform-specific binaries like rollup-linux-x64-musl)
# This fixes the "Cannot find module @rollup/rollup-linux-x64-musl" error during build
RUN npm install --legacy-peer-deps
RUN cd apps/server && npm install --legacy-peer-deps
RUN cd apps/server/web && npm install --legacy-peer-deps

# Copy source code
COPY . .

# Build web app
RUN cd apps/server/web && npm run build

# Generate Prisma client
RUN cd apps/server && npx prisma generate

# Install tsx globally
RUN npm install -g tsx@4.19.2

# Create uploads directory
RUN mkdir -p apps/server/uploads

# ============================================
# Production stage
# ============================================
FROM node:20-alpine

WORKDIR /app

# Install tsx globally in production stage
RUN npm install -g tsx@4.19.2

# Copy built artifacts and dependencies from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/apps/server/package*.json ./apps/server/
COPY --from=builder /app/apps/server/web/package*.json ./apps/server/web/
COPY --from=builder /app/apps/server/web/dist ./apps/server/web/dist
COPY --from=builder /app/apps/server/web/public ./apps/server/web/public
COPY --from=builder /app/apps/server/src ./apps/server/src
COPY --from=builder /app/apps/server/prisma ./apps/server/prisma
COPY --from=builder /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=builder /app/node_modules ./node_modules

# Environment
ENV NODE_ENV=production
ENV PORT=3001

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1

# Copy start script
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

CMD ["/app/start.sh"]
