FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY auth.js ./

RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 8080

CMD ["node", "server.js"]
