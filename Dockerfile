# 使用官方 Node.js 運行時作為基礎映像
FROM node:18-alpine

# 設定工作目錄
WORKDIR /app

# 複製 package.json 和 package-lock.json
COPY package*.json ./

# 安裝後端依賴
RUN npm install --production

# 建立 client 目錄
RUN mkdir -p client

# 複製前端 package.json
COPY client/package*.json ./client/

# 安裝前端依賴
RUN cd client && npm install

# 複製所有原始碼
COPY . .

# 建置前端
RUN cd client && npm run build

# 暴露端口
EXPOSE 3000

# 啟動應用程式
CMD ["npm", "start"]