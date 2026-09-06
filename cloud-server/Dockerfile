FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S jiege && adduser -S jiege -G jiege
COPY --from=dependencies /app/node_modules ./node_modules
COPY --chown=jiege:jiege package.json server.mjs admin.mjs admin-core.mjs migrate.mjs schema.sql ./
COPY --chown=jiege:jiege migrations ./migrations
USER jiege
EXPOSE 8787
CMD ["node","server.mjs"]
