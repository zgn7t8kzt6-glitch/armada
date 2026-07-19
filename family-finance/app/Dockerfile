# FamilyOS Phase 1 — production image
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
# Render injects PORT; server.js reads it
CMD ["node", "server.js"]
