FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

# Accept the API URL at build time so Vite can bake it in
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

COPY . .
RUN npm run build

# Serve the built files with a lightweight static server
FROM node:20-alpine
RUN npm install -g serve
WORKDIR /app
COPY --from=builder /app/dist ./dist

EXPOSE 5173
CMD ["serve", "-s", "dist", "-l", "5173"]
