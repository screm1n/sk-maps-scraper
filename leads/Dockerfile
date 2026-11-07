# Leads server. node:sqlite is built into Node 22.13+, so the only dependency is
# libphonenumber-js (pure JS): no native build, works on amd64 and Apple Silicon.
FROM node:22.20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY src ./src
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "--no-warnings=ExperimentalWarning", "server.js"]
