# ==============================================================================
# STAGE 1: Dependency Installation & Compilation
# ==============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install native build tools required by argon2
RUN apk add --no-cache python3 make g++

COPY package*.json ./
COPY tsconfig.json ./

# Install ALL dependencies (including devDependencies for TypeScript build)
RUN npm ci

COPY src ./src

# Compile TypeScript to JavaScript (outputs to /app/dist)
RUN npm run build

# ==============================================================================
# STAGE 2: Production Dependencies Only
# ==============================================================================
FROM node:20-alpine AS prod-deps

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
# Install ONLY production dependencies (strips devDependencies)
RUN npm ci --only=production && npm cache clean --force

# ==============================================================================
# STAGE 3: Hardened Production Runtime (Minimal Footprint)
# ==============================================================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install curl for container healthcheck
RUN apk add --no-cache curl

# Copy compiled code from builder
COPY --from=builder /app/dist ./dist

# Copy production node_modules
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./

# Run container as unprivileged non-root user (NFR-2 Security)
USER node

EXPOSE 3000

# Container liveness health check
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/server.js"]