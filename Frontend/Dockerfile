FROM node:24-alpine
WORKDIR /frontend
ENV NODE_ENV=production HOST=0.0.0.0
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev
COPY --chown=node:node server.mjs build.mjs ./
COPY --chown=node:node app ./app
COPY --chown=node:node components ./components
COPY --chown=node:node context ./context
COPY --chown=node:node hooks ./hooks
COPY --chown=node:node lib ./lib
COPY --chown=node:node styles ./styles
RUN mkdir -p /frontend/dist && chown node:node /frontend/dist
USER node
EXPOSE 3000 3001 3002 3003
CMD ["node", "server.mjs", "applicant"]
