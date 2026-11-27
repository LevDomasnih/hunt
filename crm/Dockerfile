# Hunt on an ordinary server: the Worker on Node with SQLite (node/server.mjs). Build from crm/ after the countries are copied:
#   node scripts/copy-art.mjs --no-demo && docker build -t hunt .
#   docker run -d --name hunt -p 8787:8787 -v hunt-db:/app/data --env-file hunt.env hunt
FROM node:22-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN test -f public/art/regions.json || (echo "run node scripts/copy-art.mjs --no-demo before docker build" && exit 1)
RUN node scripts/build-web.mjs && node scripts/build-node.mjs

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787 HUNT_DB=/app/data/hunt.db HUNT_DOCKER=1
COPY --from=build /src/dist ./dist
COPY --from=build /src/public ./public
COPY --from=build /src/migrations ./migrations
RUN mkdir -p /app/data && chown node:node /app/data
USER node
VOLUME /app/data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server.mjs"]
