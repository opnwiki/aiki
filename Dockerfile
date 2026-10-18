FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund && npm cache clean --force && rm -f /usr/local/lib/node_modules/npm/.npmrc

FROM deps AS build
COPY . .
RUN find app -name '*.vue' -exec sed -i 's/\r$//' {} + \
 && npm run check:js && npm test && NODE_OPTIONS=--max-old-space-size=640 npm run build

FROM node:22-alpine AS migrate-deps
WORKDIR /app
COPY package-lock.json /tmp/package-lock.json
RUN node --input-type=module -e "import {readFileSync,writeFileSync} from 'node:fs'; const lock=JSON.parse(readFileSync('/tmp/package-lock.json','utf8')); const version=lock.packages?.['node_modules/pg']?.version; if(!version) throw new Error('locked pg version not found'); writeFileSync('package.json', JSON.stringify({private:true,type:'module',dependencies:{pg:version}})+'\n');" \
 && npm install --omit=dev --no-audit --no-fund --no-package-lock \
 && rm -rf /tmp/package-lock.json /root/.npm

FROM alpine:3.22 AS migrate
RUN apk add --no-cache libgcc libstdc++ \
 && addgroup -S -g 1000 node \
 && adduser -S -D -H -u 1000 -G node node
WORKDIR /app
COPY --from=migrate-deps /usr/local/bin/node /usr/local/bin/node
COPY --from=migrate-deps /app/package.json /app/package.json
COPY --from=migrate-deps /app/node_modules /app/node_modules
COPY scripts/migrate.js scripts/migrate.js
COPY server/utils/migration-safety.js server/utils/migration-safety.js
COPY database/migrations database/migrations
USER node
CMD ["node", "scripts/migrate.js"]

FROM alpine:3.22 AS runtime
ENV NODE_ENV=production NITRO_HOST=0.0.0.0 NITRO_PORT=3000
RUN apk add --no-cache libgcc libstdc++ \
 && addgroup -S -g 1000 node \
 && adduser -S -D -H -u 1000 -G node node \
 && mkdir -p /var/lib/aiki \
 && chown node:node /var/lib/aiki
WORKDIR /app
COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY --from=build --chown=node:node /app/.output ./.output
COPY docker/entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod 755 /entrypoint.sh
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node --input-type=module -e "const r = await fetch('http://127.0.0.1:3000/api/health'); const b = await r.json(); if (!r.ok || b.status !== 'ok' || b.database !== 'ok') process.exit(1)"
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", ".output/server/index.mjs"]
