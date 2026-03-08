# Base image
FROM node:20-alpine

# Configure npm to use registry mirror (for better connectivity in China)
RUN npm config set registry https://registry.npmmirror.com

# Configure Prisma to use mirror (for better connectivity in China)
ENV PRISMA_BINARIES_MIRROR=https://prisma.npmmirror.com

# Create app directory
WORKDIR /app

# Copy app source
COPY ./shared ./shared
COPY ./bytebot-agent/ ./bytebot-agent/

WORKDIR /app/bytebot-agent

# Install dependencies
RUN npm install

# Generate Prisma Client before build
RUN npx prisma generate

RUN npm run build

# Run the application
CMD ["npm", "run", "start:prod"] 


