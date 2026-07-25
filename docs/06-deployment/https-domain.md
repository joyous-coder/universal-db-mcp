# 域名与 HTTPS 配置指南

通过域名访问 Universal DB MCP 的完整配置步骤。

## 📋 配置概览

```
用户访问 mcp.yourdomain.com
        ↓
[腾讯云 DNS 解析] → 指向华为云服务器 IP
        ↓
[华为云 Nginx :80/443] → 反向代理
        ↓
[MCP 服务 :3001]
```

---

## 步骤 1: 腾讯云配置二级域名解析

### 1.1 登录腾讯云控制台

1. 打开 [腾讯云 DNS 解析控制台](https://console.cloud.tencent.com/cns)
2. 找到您的域名，点击**解析**

### 1.2 添加解析记录

点击**添加记录**，填写：

| 字段 | 值 |
|------|-----|
| 主机记录 | `mcp`（这样二级域名就是 `mcp.yourdomain.com`） |
| 记录类型 | `A` |
| 线路类型 | `默认` |
| 记录值 | `您的华为云服务器公网 IP` |
| TTL | `600`（默认即可） |

点击**确认**保存。

### 1.3 验证解析是否生效

等待 2-5 分钟后，在服务器上执行：

```bash
ping mcp.yourdomain.com
```

看到返回您的服务器 IP 就说明解析成功。

---

## 步骤 2: 华为云安全组配置

确保放行 80 端口（HTTP）和 443 端口（HTTPS）：

1. 登录华为云控制台
2. 进入**安全组**设置
3. 添加入方向规则：

| 协议 | 端口 | 源地址 |
|------|------|--------|
| TCP | 80 | 0.0.0.0/0 |
| TCP | 443 | 0.0.0.0/0 |

---

## 步骤 3: 配置 Nginx 反向代理

### 3.1 查看现有 Nginx 配置

```bash
# 查看已有的配置文件
ls /etc/nginx/sites-enabled/
```

### 3.2 创建 MCP 服务的 Nginx 配置

```bash
# 创建配置文件（请将 mcp.yourdomain.com 替换为您的实际域名）
sudo tee /etc/nginx/sites-available/universal-db-mcp << 'EOF'
server {
    listen 80;
    server_name mcp.yourdomain.com;  # ← 替换为您的二级域名

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # 超时设置
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
EOF
```

### 3.3 修改配置中的域名

```bash
# 用 nano 编辑，替换为您的真实域名
sudo nano /etc/nginx/sites-available/universal-db-mcp
```

**Nano 操作步骤：**

1. 使用方向键找到 `server_name mcp.yourdomain.com;` 这一行
2. 将 `mcp.yourdomain.com` 改为您的实际二级域名
3. 按 `Ctrl + O` 保存
4. 按 `Enter` 确认
5. 按 `Ctrl + X` 退出

### 3.4 启用配置

```bash
# 创建软链接启用配置
sudo ln -s /etc/nginx/sites-available/universal-db-mcp /etc/nginx/sites-enabled/

# 测试配置是否正确
sudo nginx -t
```

如果显示：
```
nginx: configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

说明配置正确。

### 3.5 重新加载 Nginx

```bash
sudo systemctl reload nginx
```

---

## 步骤 4: 验证 HTTP 访问

在浏览器或 Apipost 中访问：

```
http://mcp.yourdomain.com/api/health
```

应该返回：
```json
{"status":"ok","timestamp":"..."}
```

---

## 步骤 5: 配置 HTTPS（推荐）

### 5.1 检查 Certbot 是否已安装

```bash
certbot --version
```

如果未安装：

```bash
sudo apt install -y certbot python3-certbot-nginx
```

### 5.2 查看已有证书（可选）

```bash
sudo certbot certificates
```

### 5.3 申请 SSL 证书

```bash
# 替换为您的域名和邮箱
sudo certbot --nginx -d mcp.yourdomain.com -m your-email@example.com --agree-tos
```

**关于邮箱：**

- 任何有效邮箱都可以（QQ邮箱、163、Gmail 等）
- 用于接收证书到期提醒和安全通知
- 建议使用常用邮箱

**交互选项：**

- 如果询问是否重定向 HTTP 到 HTTPS，选择 `2`（自动重定向）

### 5.4 验证 HTTPS 访问

```
https://mcp.yourdomain.com/api/health
```

### 5.5 设置自动续期

```bash
# 测试自动续期
sudo certbot renew --dry-run

# 证书会自动续期，无需手动操作
```

---

## 📝 配置完成后速查表

| 项目 | 值 |
|------|-----|
| 二级域名 | `mcp.yourdomain.com` |
| DNS 解析 | A 记录 → 华为云服务器 IP |
| Nginx 配置文件 | `/etc/nginx/sites-available/universal-db-mcp` |
| 服务内部端口 | 3001 |
| 对外端口 | 80 (HTTP) / 443 (HTTPS) |
| HTTP 访问 | `http://mcp.yourdomain.com/api/health` |
| HTTPS 访问 | `https://mcp.yourdomain.com/api/health` |

---

## 🔧 Nginx 常用运维命令

```bash
# 查看 Nginx 状态
sudo systemctl status nginx

# 测试配置文件语法
sudo nginx -t

# 重新加载配置（修改配置后）
sudo systemctl reload nginx

# 重启 Nginx
sudo systemctl restart nginx

# 查看错误日志
sudo tail -f /var/log/nginx/error.log

# 查看访问日志
sudo tail -f /var/log/nginx/access.log
```

---

## 🔐 Certbot 常用命令

```bash
# 查看已申请的证书
sudo certbot certificates

# 手动续期证书
sudo certbot renew

# 测试续期（不实际执行）
sudo certbot renew --dry-run

# 删除证书
sudo certbot delete --cert-name mcp.yourdomain.com
```

---

## ⚠️ 注意事项

1. **域名替换**：所有 `mcp.yourdomain.com` 都要替换为您的实际域名
2. **等待解析**：DNS 解析可能需要几分钟生效
3. **安全组**：确保华为云安全组放行了 80 和 443 端口
4. **不影响其他服务**：新配置是独立的，不会影响 FastGPT 等已有服务
5. **证书自动续期**：Let's Encrypt 证书有效期 90 天，Certbot 会自动续期

---

## 🛠 故障排查

### DNS 解析不生效

```bash
# 检查解析
nslookup mcp.yourdomain.com

# 或使用 dig
dig mcp.yourdomain.com
```

### Nginx 配置错误

```bash
# 测试配置
sudo nginx -t

# 查看错误详情
sudo tail -50 /var/log/nginx/error.log
```

### HTTPS 证书申请失败

```bash
# 确保 80 端口可访问（Let's Encrypt 验证需要）
curl http://mcp.yourdomain.com

# 查看 Certbot 日志
sudo tail -50 /var/log/letsencrypt/letsencrypt.log
```

### 502 Bad Gateway 错误

```bash
# 检查 MCP 服务是否运行
docker ps | grep universal-db-mcp

# 检查服务日志
cd /opt/universal-db-mcp
docker compose logs
```
