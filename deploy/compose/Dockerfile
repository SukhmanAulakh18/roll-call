# Roll Call runtime image. Used by every service in docker-compose.yml.
# No build step: the backend is TypeScript that Node 22 runs directly (native type stripping).
# Build context is the repository root (see docker-compose.yml).
FROM node:22-alpine

WORKDIR /app

# Repository contents. Zero runtime dependencies for the backend, so no npm install is needed.
COPY . .

ENV NODE_ENV=production

# Each service sets its own command, role and ports in docker-compose.yml.
# 7100 control (+UI), 7200 gateway, 7300 tools.
EXPOSE 7100 7200 7300

CMD ["node", "scripts/serve.ts"]
