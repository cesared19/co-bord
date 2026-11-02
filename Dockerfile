# Builds the client and the server into one image: the server serves the client and the API.
FROM node:22-alpine AS client
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22-alpine AS server
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 CLIENT_DIR=/app/client
WORKDIR /app/server
COPY --from=server /app/server/package.json ./
COPY --from=server /app/server/node_modules ./node_modules
COPY --from=server /app/server/dist ./dist
COPY --from=client /app/client/dist /app/client
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
