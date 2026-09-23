FROM node:22-bookworm-slim

# assimp-utils: conversão GLB -> DAE/OBJ/STL (formatos que o SketchUp importa)
RUN apt-get update \
 && apt-get install -y --no-install-recommends assimp-utils zip ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY src ./src

ENV NODE_ENV=production PORT=3000
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
