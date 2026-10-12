# Nexus API: the deployment image.
# Multi-stage build: dependencies and compilation stay out of the runtime layer.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The Prisma client is emitted into src/generated, so it must exist before compilation
RUN npx prisma generate && npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# The container applies its own migrations before serving, so the image ships
# the Prisma CLI, the schema, the migrations and the config that hands the CLI
# its URL. `migrate deploy` takes an advisory lock, so parallel replicas wait
# rather than collide, and it is a no-op once the schema is current.
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/generated ./src/generated
COPY prisma ./prisma
COPY prisma.config.ts ./
# The API runs as the unprivileged node user. Uploaded files kept locally go to
# /app/.storage (STORAGE_LOCAL_DIR), so that directory belongs to it; a volume
# mounted there must be writable by uid 1000.
RUN mkdir -p /app/.storage && chown node:node /app/.storage
USER node

# The same route the load balancer polls; it is @Public() precisely for this
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

EXPOSE 8000
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/main.js"]
