# debian with buildpack-deps
FROM node:lts-alpine

WORKDIR /src

COPY package.json /src
RUN npm install

COPY . /src

EXPOSE 4000

CMD ["node", "node_server.js"]
