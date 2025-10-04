FROM node:lts-alpine

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install --production

COPY . .

ENV PORT=10000
EXPOSE 10000

CMD ["npm", "start"]
