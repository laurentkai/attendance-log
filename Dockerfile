FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node views ./views
RUN mkdir -p /app-secrets && chown node:node /app-secrets && chmod 700 /app-secrets

USER node
EXPOSE 3000

CMD ["node", "src/server.js"]
