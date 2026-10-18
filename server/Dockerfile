FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY stream-gateway.js users.js monitor.js ./

ENV PORT=8080 NODE_ENV=production USERS_FILE=/data/users.json
# รายชื่อผู้ใช้ (users.json) — เก็บใน volume เพื่อไม่ให้หายเมื่ออัปเดต
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8080
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "require('http').get('http://127.0.0.1:'+process.env.PORT,r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "stream-gateway.js"]
