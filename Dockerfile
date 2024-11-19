# FROM node:slim
FROM node:lts-alpine3.20

ENV APP_USER=node

WORKDIR /src

COPY . /src

RUN npm install
# RUN npm update -g npm

# RUN npm install && \
# 	npm audit fix

# CVE Resolutions
RUN rm -rf /usr/local/lib/node_modules/cross-spawn && \
    cd /usr/local/lib/node_modules/npm && \
    npm install -g cross-spawn@7.0.5

RUN chown -R $APP_USER:$APP_USER /src

EXPOSE 4000

USER $APP_USER

CMD ["node", "node_server.js"]
