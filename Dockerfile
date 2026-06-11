# Armada Care Standards — container image for HIPAA-eligible hosts
# (Aptible, AWS ECS/Beanstalk, Google Cloud Run, Render, etc.)
FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
# Persist the database on a mounted, encrypted volume in production:
ENV ARMADA_DB=/data/armada.db
EXPOSE 3000

CMD ["node", "server.js"]
