# Nexus frontend: the deployment image.
# NEXT_PUBLIC_* values are inlined at build time, so the API URL must be passed
# as a build argument, not at container start.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# Optional: a BugSnag browser key and the release stage it reports under
ARG NEXT_PUBLIC_BUGSNAG_API_KEY=
ENV NEXT_PUBLIC_BUGSNAG_API_KEY=$NEXT_PUBLIC_BUGSNAG_API_KEY
ARG NEXT_PUBLIC_APP_ENV=development
ENV NEXT_PUBLIC_APP_ENV=$NEXT_PUBLIC_APP_ENV
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
# The standalone output carries its own server and only the modules it traces,
# so the runtime layer holds no build tooling
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
