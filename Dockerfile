FROM node:lts-alpine

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install --production

COPY . .

RUN npm run build

RUN npm prune --production

ENV PORT=10000
EXPOSE 10000

CMD ["npm", "start"]
