FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node auth.mjs session-store.mjs server.mjs whatsapp.mjs drafts.mjs workflow.mjs analytics.mjs infra.mjs ./
COPY --chown=node:node connect ./connect
RUN mkdir -p /data/panel-sessions && chown node:node /data/panel-sessions && chmod 700 /data/panel-sessions
USER node
EXPOSE 3080
CMD ["node", "server.mjs"]
