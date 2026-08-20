FROM nginx:1.27-alpine

WORKDIR /usr/share/nginx/html
COPY index.html ./index.html
COPY manifest.webmanifest ./manifest.webmanifest
COPY styles.css ./styles.css
COPY app.js ./app.js
COPY assets ./assets
COPY vendor ./vendor

EXPOSE 80
