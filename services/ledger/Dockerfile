FROM node:18

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm install

# Bundle app source
COPY . .

# Compile once in the image, not concurrently in every validator at startup.
RUN npm run build

# main port
EXPOSE 8000
# rpc
EXPOSE 7887
# dashboard plugin
EXPOSE 8001

CMD [ "npm", "run", "start" ]
