# Alternative to render.yaml for Railway / Fly / any container host.
FROM node:22-slim AS build
WORKDIR /app
COPY client/package*.json client/
RUN npm ci --prefix client
COPY client client
RUN npm run build --prefix client

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY server/package*.json server/
RUN npm ci --prefix server --omit=dev
COPY server server
COPY --from=build /app/client/dist client/dist
EXPOSE 4000
CMD ["npm", "start", "--prefix", "server"]
