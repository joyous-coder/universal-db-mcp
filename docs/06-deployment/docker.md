# Docker 部署

本文档介绍如何使用 Docker 部署 Universal DB MCP。

## 前置要求

- Docker >= 20.10
- Docker Compose >= 2.0（可选）

## 快速开始

### 使用 Docker Compose（推荐）

```bash
cd docker
docker-compose up -d
```

### 直接运行

```bash
# 构建镜像
docker build -t universal-db-mcp -f docker/Dockerfile .

# 运行容器
docker run -p 3000:3000 \
  -e MODE=http \
  -e API_KEYS=your-secret-key \
  universal-db-mcp
```

## Dockerfile

项目提供了优化的多阶段构建 Dockerfile：

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

## Docker Compose 配置

### 基础配置

`docker-compose.yml`：

```yaml
version: '3.8'

services:
  universal-db-mcp:
    build:
      context: ..
      dockerfile: docker/Dockerfile
    container_name: universal-db-mcp
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - MODE=http
      - HTTP_PORT=3000
      - HTTP_HOST=0.0.0.0
    env_file:
      - .env.docker
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### 生产环境配置

`docker-compose.prod.yml`：

```yaml
version: '3.8'

services:
  universal-db-mcp:
    build:
      context: ..
      dockerfile: docker/Dockerfile
    container_name: universal-db-mcp
    restart: always
    ports:
      - "127.0.0.1:3000:3000"  # 仅本地访问，通过 Nginx 代理
    environment:
      - MODE=http
      - HTTP_PORT=3000
      - HTTP_HOST=0.0.0.0
    env_file:
      - .env
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
    deploy:
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 256M
```

## 环境变量配置

创建 `.env.docker` 文件：

```bash
# 服务器模式
MODE=http

# HTTP 配置
HTTP_PORT=3000
HTTP_HOST=0.0.0.0

# API 密钥（重要：使用强密钥！）
API_KEYS=your-strong-api-key-here

# CORS 配置
CORS_ORIGINS=*
CORS_CREDENTIALS=false

# 速率限制
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=1m

# 日志
LOG_LEVEL=info
LOG_PRETTY=false

# 会话管理
SESSION_TIMEOUT=3600000
SESSION_CLEANUP_INTERVAL=300000
```

## 常用命令

### 构建和启动

```bash
# 构建镜像
docker-compose build

# 启动服务（后台运行）
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

### 更新版本

```bash
# 停止服务
docker-compose down

# 重新构建（拉取最新代码后）
docker-compose build --no-cache

# 启动服务
docker-compose up -d
```

### 清理

```bash
# 停止并删除容器、网络
docker-compose down

# 停止并删除容器、网络、镜像
docker-compose down --rmi all

# 清理未使用的镜像
docker image prune -f
```

## 连接数据库

### 连接宿主机数据库

使用 `host.docker.internal`：

```bash
docker run -p 3000:3000 \
  -e MODE=http \
  -e API_KEYS=your-key \
  -e DB_TYPE=mysql \
  -e DB_HOST=host.docker.internal \
  -e DB_PORT=3306 \
  -e DB_USER=root \
  -e DB_PASSWORD=xxx \
  -e DB_DATABASE=test \
  universal-db-mcp
```

### 连接其他容器

使用 Docker 网络：

```yaml
version: '3.8'

services:
  universal-db-mcp:
    # ... 配置 ...
    networks:
      - db-network

  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: password
      MYSQL_DATABASE: test
    networks:
      - db-network

networks:
  db-network:
    driver: bridge
```

然后使用服务名作为主机名：`DB_HOST=mysql`

## 健康检查

```bash
# 检查容器状态
docker ps

# 检查健康状态
docker inspect --format='{{.State.Health.Status}}' universal-db-mcp

# 手动测试
curl http://localhost:3000/api/health
```

## 日志管理

### 查看日志

```bash
# 实时日志
docker-compose logs -f

# 最近 100 行
docker-compose logs --tail 100

# 指定时间范围
docker-compose logs --since 1h
```

### 日志轮转

Docker 默认配置了日志轮转，可以在 `docker-compose.yml` 中自定义：

```yaml
logging:
  driver: "json-file"
  options:
    max-size: "10m"
    max-file: "3"
```

## 资源限制

```yaml
deploy:
  resources:
    limits:
      cpus: '1'
      memory: 512M
    reservations:
      cpus: '0.5'
      memory: 256M
```

## 安全建议

1. **不要暴露端口到公网** - 使用 `127.0.0.1:3000:3000` 仅本地访问
2. **使用 Nginx 反向代理** - 配置 SSL 和访问控制
3. **使用非 root 用户** - Dockerfile 中已配置 `USER node`
4. **定期更新镜像** - 及时修复安全漏洞

## 下一步

- [HTTPS 配置](./https-domain.md) - 配置域名和 SSL
- [云服务部署](./cloud/) - 云平台部署
- [运维指南](../operations/guide.md) - 日常运维操作
