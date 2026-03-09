# Base image - using DaoCloud mirror for better connectivity in China
FROM docker.m.daocloud.io/library/node:20-alpine

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

# Install shared package dependencies
WORKDIR /app/shared
RUN npm install

# Install bytebot-agent dependencies
WORKDIR /app/bytebot-agent
RUN npm install

RUN npm run build

# Run the application
CMD ["npm", "run", "start:prod"] 


