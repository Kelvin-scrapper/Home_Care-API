FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY db ./db

ENV PORT=3000
EXPOSE 3000

# Apply the schema, seed users, then start the API. Both DB steps are
# idempotent, so this is safe on every restart. A failed seed is logged but
# doesn't stop the API from starting.
CMD ["sh", "-c", "node db/setup.js && { node db/seed.js || echo 'User seed failed - see the error above. Starting the API anyway.'; } && exec node src/index.js"]
