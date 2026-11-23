# 多阶段构建
# 阶段 1: 构建前端
FROM node:22-alpine AS build-frontend

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts tailwind.config.js postcss.config.js eslint.config.js ./
COPY index.html ./
COPY public/ ./public/
COPY src/ ./src/
COPY design-tokens/ ./design-tokens/

RUN npm run build

# 阶段 2: 运行服务
FROM node:22-alpine

WORKDIR /app

# 安装运行时依赖（仅 production）
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 复制后端代码
COPY server/ ./server/
COPY modules/ ./modules/

# 复制前端构建产物
COPY --from=build-frontend /app/dist ./dist

# 数据目录（挂载卷）
VOLUME [ "/app/data" ]

# 环境变量
ENV PORT=3000
ENV NODE_ENV=production
ENV TZ=Asia/Shanghai

# JWT密钥 — 必须通过环境变量设置一个唯一的密钥！
# ENV JWT_SECRET=your-super-secret-key-change-me

EXPOSE 3000

# 使用 tini 以正确处理信号
RUN apk add --no-cache tini tzdata
ENTRYPOINT ["/sbin/tini", "--"]

CMD ["node", "server/index.cjs"]
