FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node auth.mjs server.mjs whatsapp.mjs drafts.mjs ./
COPY --chown=node:node connect ./connect
USER node
EXPOSE 3080
CMD ["node", "server.mjs"]
