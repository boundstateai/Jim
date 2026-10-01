FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY package*.json ./
RUN npm ci --omit=dev
COPY api ./api
COPY scripts ./scripts
# The server-selected course profile imports the shared curriculum.
COPY src/packs ./src/packs
COPY src/activity.js ./src/activity.js
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["npm", "start"]
