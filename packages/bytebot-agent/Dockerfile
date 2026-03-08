# Base image
FROM node:20-alpine

# Configure npm to use registry mirror (for better connectivity in China)
RUN npm config set registry https://registry.npmmirror.com

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

# Configure Prisma to use淘宝镜像
ENV PRISMA_BINARIES_MIRROR=https://npmmirror.com/mirrors/prisma

# Create app directory
WORKDIR /app

# Copy app source
COPY ./shared ./shared
COPY ./bytebot-agent/ ./bytebot-agent/

WORKDIR /app/bytebot-agent

# Install dependencies
RUN npm install

RUN npm run build

# Set Node.js timeout environment variables
# 解决 fetch 超时问题
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV UV_THREADPOOL_SIZE=128
ENV NODE_NO_WARNINGS=1

# Run the application
CMD ["npm", "run", "start:prod"] 


