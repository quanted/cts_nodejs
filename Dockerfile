# debian with buildpack-deps
FROM node:lts-alpine

WORKDIR /src

COPY . /src

RUN npm install && \
	npm audit fix

EXPOSE 4000

CMD ["node", "node_server.js"]
