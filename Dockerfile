FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY db ./db

ENV PORT=3000
EXPOSE 3000

# Apply the schema, seed users, then start the API. Both DB steps are
# idempotent, so this is safe on every restart.
CMD ["sh", "-c", "node db/setup.js && node db/seed.js && exec node src/index.js"]
