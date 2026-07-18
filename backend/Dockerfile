FROM node:22-alpine
WORKDIR /app
COPY package*.json .
COPY prisma ./prisma
COPY prisma.config.ts .
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN npm install
COPY . .
EXPOSE 8000
CMD ["npm", "run", "dev"]
