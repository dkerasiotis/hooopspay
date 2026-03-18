FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY backend/package.json ./backend/
RUN cd backend && npm install --omit=dev

# Copy source
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Data volume mountpoint
VOLUME ["/data"]

EXPOSE 5002

CMD ["node", "backend/server.js"]
