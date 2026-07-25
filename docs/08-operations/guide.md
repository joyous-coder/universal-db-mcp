# Universal DB MCP 运维管理指南

## 📍 基础操作

所有命令需要先进入项目目录：

```bash
cd /opt/universal-db-mcp
```

---

## 🔄 启动 / 停止 / 重启

```bash
# 启动服务
docker compose up -d

# 停止服务
docker compose down

# 重启服务
docker compose restart

# 停止但不删除容器
docker compose stop

# 启动已停止的容器
docker compose start
```

---

## 📊 查看状态

```bash
# 查看容器运行状态
docker compose ps

# 查看所有容器（包括停止的）
docker ps -a | grep universal-db-mcp

# 查看资源占用（CPU、内存）
docker stats universal-db-mcp
```

---

## 📋 查看日志

```bash
# 查看实时日志
docker compose logs -f

# 查看最近 100 行日志
docker compose logs --tail 100

# 查看指定时间内的日志
docker compose logs --since 1h
```

---

## 🔧 更新版本

```bash
cd /opt/universal-db-mcp

# 停止服务
docker compose down

# 重新构建（拉取最新 npm 包）
docker compose build --no-cache

# 启动服务
docker compose up -d
```

---

## 🩺 健康检查

```bash
# 本地检查
curl http://localhost:3001/api/health

# 外网检查（使用您的服务器公网 IP）
curl http://YOUR_SERVER_IP:3001/api/health
```

---

## 🧹 清理操作

```bash
# 停止并删除容器、网络
docker compose down

# 停止并删除容器、网络、镜像
docker compose down --rmi all

# 清理未使用的镜像（释放磁盘空间）
docker image prune -f
```

---

## 📝 快速命令速查表

| 操作 | 命令 |
|------|------|
| 启动 | `docker compose up -d` |
| 停止 | `docker compose down` |
| 重启 | `docker compose restart` |
| 状态 | `docker compose ps` |
| 日志 | `docker compose logs -f` |
| 健康检查 | `curl http://localhost:3001/api/health` |

---

## 💡 设置开机自启

Docker 服务默认开机自启，由于配置了 `restart: unless-stopped`，服务器重启后容器会自动启动。

确认 Docker 开机自启：

```bash
sudo systemctl enable docker
```

---

## 🔐 安全配置

### 修改 API 密钥

编辑 `.env` 文件：

```bash
nano /opt/universal-db-mcp/.env
```

修改 `API_KEYS` 为您自己的安全密钥：

```env
API_KEYS=your-secure-api-key
```

修改后重启服务：

```bash
docker compose restart
```

---

## 🌐 服务端点

- **健康检查**: `GET /api/health`
- **连接数据库**: `POST /api/connect`
- **执行查询**: `POST /api/query`
- **获取表结构**: `GET /api/schema`

### 请求示例

```bash
# 连接数据库
curl -X POST http://localhost:3001/api/connect \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "mysql",
    "host": "your-db-host",
    "port": 3306,
    "user": "your-user",
    "password": "your-password",
    "database": "your-database"
  }'

# 执行查询
curl -X POST http://localhost:3001/api/query \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "sql": "SELECT * FROM users LIMIT 10"
  }'
```

---

## 🛠 故障排查

### 容器无法启动

```bash
# 查看详细错误日志
docker compose logs

# 检查配置文件
cat /opt/universal-db-mcp/.env
cat /opt/universal-db-mcp/docker-compose.yml
```

### 端口被占用

```bash
# 查看端口占用
sudo lsof -i :3001

# 修改端口后重启
docker compose down
docker compose up -d
```

### 内存不足

```bash
# 查看系统内存
free -h

# 查看容器资源使用
docker stats
```
