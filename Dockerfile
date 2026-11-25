FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# Dev dependencies are kept: tsx runs the TypeScript sources and the same image runs the gates.
RUN npm ci --include=dev --no-audit --no-fund
COPY . .
EXPOSE 3000
HEALTHCHECK --interval=2s --timeout=3s --start-period=5s --retries=30 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "src/main.ts"]
