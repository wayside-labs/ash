FROM node:24-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# Fixed uid so /opt/ash-studio/uploads can be chowned on the host before the first run.
RUN addgroup -S -g 10001 app && adduser -S -u 10001 -G app app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/dist ./dist
# dist/migrate.mjs resolves its migrations as ../drizzle, i.e. /app/drizzle next to /app/dist.
COPY --from=build --chown=app:app /app/drizzle ./drizzle
USER app
EXPOSE 3000
CMD ["node", "server.js"]
