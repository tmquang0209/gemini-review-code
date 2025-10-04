# -------- Stage 1: Build --------
FROM node:lts-alpine AS builder

WORKDIR /usr/src/app

# Copy package.json trước để cache npm install
COPY package*.json ./

# Cài full deps (cả devDependencies để build)
RUN npm install

# Copy source code
COPY . .

# Build TypeScript -> dist/
RUN npm run build

# -------- Stage 2: Runtime --------
FROM node:lts-alpine AS runner

WORKDIR /usr/src/app

# Copy package.json để install production deps
COPY package*.json ./

# Chỉ cài deps production
RUN npm install --production

# Copy dist đã build từ builder stage
COPY --from=builder /usr/src/app/dist ./dist

ENV PORT=10000
EXPOSE 10000

CMD ["node", "dist/index.js"]
