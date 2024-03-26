# FROM node:slim
FROM node:lts-alpine

ENV APP_USER=node

WORKDIR /src

COPY . /src

RUN npm install
RUN npm update -g npm
RUN npm install -g ip@2.0.1

# RUN npm install && \
# 	npm audit fix

RUN chown -R $APP_USER:$APP_USER /src

EXPOSE 4000

USER $APP_USER

CMD ["node", "node_server.js"]
