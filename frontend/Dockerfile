# syntax=docker/dockerfile:1
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 8080

# Set API_UPSTREAM to the backend's Railway private URL, including its port,
# for example: http://${{backend.RAILWAY_PRIVATE_DOMAIN}}:${{backend.PORT}}
ENV PORT=8080 \
    API_UPSTREAM=http://127.0.0.1:8000
