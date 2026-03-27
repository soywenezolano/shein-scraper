FROM mcr.microsoft.com/playwright:v1.40.0-jammy

WORKDIR /app

COPY package.json .
RUN npm install

# Instalar solo Chromium
RUN npx playwright install chromium

COPY server.js .

EXPOSE 3000

CMD ["node", "server.js"]
