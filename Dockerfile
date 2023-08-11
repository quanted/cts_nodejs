# debian with buildpack-deps
# FROM node:lts-alpine
FROM ghcr.io/quanted/cts-nodejs-base:dev-kube

ENV APP_USER=node

WORKDIR /src

COPY . /src

RUN npm install

# RUN npm install && \
# 	npm audit fix

RUN chown -R $APP_USER:$APP_USER /src

RUN cd /usr/local/lib/node_modules/npm/node_modules/semver

EXPOSE 4000

USER $APP_USER

CMD ["node", "node_server.js"]
