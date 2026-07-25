# Docker 设置(Windows + WSL 模式)

## 架构

- **WSL**:跑 docker daemon + docker CLI(`wsl docker ...`)
- **Claude Code 宿主机(Windows)**:Node / npm / vitest / `node dist/index.js`(MCP server)
- 容器端口通过 `-p <host>:<container>` 映射到 Windows `localhost`,MCP server 直接连

```
[ Claude Code (Windows host) ]          [ WSL (Ubuntu) ]              [ Docker containers ]
   ├─ Bash / Node / npm / vitest        ├─ docker daemon              ├─ postgres:16-alpine
   ├─ edit files                        ├─ docker pull                ├─ mysql:8
   ├─ git push                          ├─ docker run -p ...          ├─ mongodb:7
   ├─ node dist/index.js  ←───────stdin/stdout─────────→  (MCP server process)
   └─ connect localhost:5432 etc. ──port-mapped from containers─→  DBs
```

**WSL 不需要 Node** — Node/vitest/MCP server 全部跑在 Claude Code 宿主机。

## 前置条件

- Windows 10/11
- WSL2 已启用(`wsl --status` 显示 "默认版本: 2")
- Docker Desktop 已装并启用 WSL2 集成

## 镜像加速(国内推荐)

编辑 `~/.docker/daemon.json`:

```json
{
  "registry-mirrors": [
    "https://<your-mirror>.mirror.aliyuncs.com"
  ]
}
```

重启 Docker Desktop。

## 验证

```bash
wsl docker --version        # 应输出 docker 版本
node --version && npm --version   # 宿主机 Node 可用
```

## 项目用到的 DB 镜像

| 镜像 | 大小 |
|---|---|
| postgres:16-alpine | ~80MB |
| mysql:8 | ~500MB |
| mongodb:7 | ~700MB |
| redis:7-alpine | ~40MB |
| clickhouse/clickhouse-server:24-alpine | ~800MB |
| mcr.microsoft.com/mssql/server:2022-latest | ~1.5GB |
| gvenzl/oracle-xe:21-slim | ~5GB |
| pingcap/tidb:v7.5 | ~1GB |
| oceanbase/oceanbase-ce:latest | ~3GB |
| opengauss/opengauss:latest | ~1.5GB |

总计约 ~15GB(常用)+ ~10GB(国产库按需)。

## 镜像保留策略

镜像默认保留在 `/var/lib/docker`(WSL 里)。后续 SSE + HTTP API 阶段会复用,**不要手动 `docker rmi`**。

```bash
docker image ls            # 列出已拉镜像
docker image prune -a      # 真正确认要清时才用
```

## 容器清理

所有测试用容器都加 `--rm` 标志,容器退出(write layer)立即清。

## 端口冲突

`docker run -p <port>:<port>` 把容器端口映射到 Windows localhost。如果 5432 被占用,改成 5433 等。

注意:`db-images.json` 里写固定端口(如 `port: 5432`),docker run 时实际映射也是同一个。如果你想换端口,改 `db-images.json` + `port` 字段 + 测试的 `cfg.port` 引用。
