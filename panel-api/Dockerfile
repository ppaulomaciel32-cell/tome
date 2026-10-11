FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node auth.mjs server.mjs ./
USER node
EXPOSE 3080
CMD ["node", "server.mjs"]
