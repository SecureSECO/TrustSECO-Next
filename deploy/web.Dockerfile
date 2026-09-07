FROM node:24 AS portal
WORKDIR /portal
COPY apps/portal/package*.json ./
RUN npm ci
COPY apps/portal/ ./
ARG PORTAL_HOST=localhost:3002
ARG COMMUNITY_DEMO=false
ENV VITE_COMMUNITY_DEMO=$COMMUNITY_DEMO
ENV VITE_HOST=$PORTAL_HOST VITE_PROTOCOL=http
RUN npm run build
FROM node:24
WORKDIR /usr/app
COPY apps/coordinator/package*.json ./
RUN npm ci
COPY apps/coordinator/src ./src
COPY apps/coordinator/tsconfig.json ./
COPY apps/coordinator/test ./test
COPY --from=portal /portal/dist ./public
RUN npx tsc
CMD ["node", "dist/app.js"]
