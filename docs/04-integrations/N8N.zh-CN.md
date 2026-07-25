# n8n 集成指南

本指南展示如何将 Universal Database MCP Server 与 n8n 工作流自动化平台集成。

## 概述

n8n 是一个工作流自动化工具。通过集成 Universal Database MCP Server，您可以创建查询和操作数据库数据的工作流。

## 前置要求

- 部署了 HTTP API 模式的 Universal Database MCP Server
- n8n 实例（自托管或云端）
- 数据库实例（MySQL、PostgreSQL 等）

## 设置步骤

### 步骤 1: 部署 HTTP API 服务器

部署 Universal Database MCP Server：

```bash
docker run -d \
  --name universal-db-mcp \
  -p 3000:3000 \
  -e MODE=http \
  -e HTTP_PORT=3000 \
  -e API_KEYS=n8n-secret-key \
  -e CORS_ORIGINS=* \
  universal-db-mcp:latest
```

### 步骤 2: 创建 n8n 工作流

1. 登录 n8n
2. 点击"新建工作流"
3. 命名您的工作流（例如："数据库查询工作流"）

### 步骤 3: 添加 HTTP 请求节点

n8n 使用 HTTP 请求节点调用 API。为每个操作添加节点：

#### 节点 1: 连接数据库

**节点类型**: HTTP Request
**名称**: `连接数据库`

**设置**:
- **方法**: POST
- **URL**: `http://localhost:3000/api/connect`
- **认证**: Generic Credential Type
  - Header Auth
  - 名称: `X-API-Key`
  - 值: `n8n-secret-key`
- **Body Content Type**: JSON
- **Body**:
```json
{
  "type": "mysql",
  "host": "localhost",
  "port": 3306,
  "user": "root",
  "password": "password",
  "database": "testdb"
}
```

**输出**: 从响应中提取 `sessionId`

#### 节点 2: 执行查询

**节点类型**: HTTP Request
**名称**: `执行查询`

**设置**:
- **方法**: POST
- **URL**: `http://localhost:3000/api/query`
- **认证**: Header Auth (X-API-Key)
- **Body**:
```json
{
  "sessionId": "{{$node['连接数据库'].json.data.sessionId}}",
  "query": "SELECT * FROM users LIMIT 10"
}
```

#### 节点 3: 处理结果

**节点类型**: Code
**名称**: `处理结果`

**代码**:
```javascript
const results = $input.all()[0].json.data.rows;

return results.map(row => ({
  json: row
}));
```

## 示例工作流

### 工作流 1: 定时数据库备份

**触发器**: 定时（每天凌晨 2 点）

**节点**:
1. **定时触发器** - 每天凌晨 2 点运行
2. **连接数据库** - 连接到数据库
3. **执行查询** - `SELECT * FROM users`
4. **转换为 CSV** - 将结果转换为 CSV
5. **发送邮件** - 通过邮件发送 CSV 文件
6. **断开数据库** - 关闭连接

### 工作流 2: Webhook 到数据库

**触发器**: Webhook

**节点**:
1. **Webhook** - 接收 HTTP POST
2. **连接数据库** - 连接到数据库
3. **执行查询** - 从 webhook 插入数据
4. **响应 Webhook** - 返回成功/错误
5. **断开数据库** - 关闭连接

**示例**:
```bash
# 触发工作流
curl -X POST https://your-n8n.com/webhook/insert-user \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alice",
    "email": "alice@example.com"
  }'
```

**查询节点**:
```json
{
  "sessionId": "{{$node['连接数据库'].json.data.sessionId}}",
  "query": "INSERT INTO users (name, email) VALUES (?, ?)",
  "params": [
    "{{$json.name}}",
    "{{$json.email}}"
  ]
}
```

### 工作流 3: 数据库间数据同步

**触发器**: 定时（每小时）

**节点**:
1. **定时触发器** - 每小时运行
2. **连接源数据库** - 连接到源数据库
3. **查询源数据** - 获取新记录
4. **连接目标数据库** - 连接到目标数据库
5. **插入到目标** - 插入记录
6. **断开两个连接** - 关闭连接

### 工作流 4: 数据库监控

**触发器**: 定时（每 5 分钟）

**节点**:
1. **定时触发器** - 每 5 分钟运行
2. **连接数据库** - 连接到数据库
3. **检查表大小** - `SELECT COUNT(*) FROM users`
4. **检查慢查询** - 查询性能模式
5. **发送告警** - 如果超过阈值发送 Slack/邮件
6. **断开数据库** - 关闭连接

## 高级模式

### 模式 1: 动态查询构建器

使用 n8n 的 Code 节点动态构建查询：

```javascript
// Code 节点
const filters = $input.all()[0].json;

let query = "SELECT * FROM users WHERE 1=1";
const params = [];

if (filters.name) {
  query += " AND name LIKE ?";
  params.push(`%${filters.name}%`);
}

if (filters.email) {
  query += " AND email = ?";
  params.push(filters.email);
}

query += " LIMIT 100";

return [{
  json: {
    query: query,
    params: params
  }
}];
```

### 模式 2: 批量处理

分批处理大数据集：

```javascript
// Code 节点
const batchSize = 1000;
const totalRecords = $input.all()[0].json.data.totalRecords;
const batches = Math.ceil(totalRecords / batchSize);

const results = [];
for (let i = 0; i < batches; i++) {
  const offset = i * batchSize;
  results.push({
    json: {
      query: `SELECT * FROM users LIMIT ${batchSize} OFFSET ${offset}`
    }
  });
}

return results;
```

### 模式 3: 错误处理

实现健壮的错误处理：

```javascript
// Code 节点
try {
  const result = $input.all()[0].json;

  if (!result.success) {
    throw new Error(result.error.message);
  }

  return [{
    json: {
      success: true,
      data: result.data
    }
  }];
} catch (error) {
  return [{
    json: {
      success: false,
      error: error.message
    }
  }];
}
```

### 模式 4: 连接池

跨工作流执行复用连接：

```javascript
// 使用 n8n 的静态数据存储会话 ID
const staticData = this.getWorkflowStaticData('global');

if (!staticData.sessionId) {
  // 连接到数据库
  const response = await this.helpers.httpRequest({
    method: 'POST',
    url: 'http://localhost:3000/api/connect',
    body: {
      type: 'mysql',
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: 'password',
      database: 'testdb'
    }
  });

  staticData.sessionId = response.data.sessionId;
}

return [{
  json: {
    sessionId: staticData.sessionId
  }
}];
```

## 与其他 n8n 节点集成

### 与 Google Sheets

**工作流**: 数据库 → Google Sheets

1. 查询数据库
2. 格式化结果
3. 写入 Google Sheets

### 与 Slack

**工作流**: 数据库告警 → Slack

1. 查询数据库指标
2. 检查阈值
3. 如果告警则发送 Slack 消息

### 与 Airtable

**工作流**: 数据库 → Airtable 同步

1. 查询数据库
2. 转换数据
3. 更新 Airtable 记录

### 与邮件

**工作流**: 数据库报告 → 邮件

1. 查询数据库
2. 生成 HTML 报告
3. 发送带报告的邮件

## 最佳实践

### 1. 使用凭据

在 n8n 凭据中存储 API Keys：

1. 转到凭据
2. 创建新的"Header Auth"凭据
3. 名称: `X-API-Key`
4. 值: 您的 API Key
5. 在 HTTP 请求节点中使用

### 2. 错误处理

为所有工作流添加错误处理：

```javascript
// 在 HTTP 请求节点设置中
// 启用"Continue On Fail"
// 添加错误处理节点
```

### 3. 日志记录

记录重要事件：

```javascript
// Code 节点
console.log('查询已执行:', query);
console.log('结果:', results.length, '行');
```

### 4. 测试

在生产前测试工作流：

1. 使用测试数据库
2. 使用小数据集测试
3. 验证错误处理
4. 检查性能

## 监控与调试

### 查看执行日志

1. 转到"执行"标签
2. 点击执行
3. 查看节点输出
4. 检查错误消息

### 调试模式

在 n8n 中启用调试模式：

```bash
# 在 docker-compose.yml 中
environment:
  - N8N_LOG_LEVEL=debug
```

### 性能监控

监控工作流性能：

1. 检查执行时间
2. 识别慢节点
3. 优化查询
4. 添加缓存

## 故障排除

### 问题：连接超时

**解决方案**:
- 增加 HTTP 请求节点中的超时时间
- 检查网络连接
- 验证 API 服务器正在运行

### 问题：会话过期

**解决方案**:
- 重新连接数据库
- 增加会话超时时间
- 实现连接池

### 问题：大结果集

**解决方案**:
- 为查询添加 LIMIT
- 使用分页
- 分批处理

## 完整 ETL 工作流示例

```json
{
  "name": "ETL: MySQL 到 PostgreSQL",
  "nodes": [
    {
      "name": "定时",
      "type": "n8n-nodes-base.scheduleTrigger",
      "parameters": {
        "rule": {
          "interval": [{"field": "hours", "hoursInterval": 1}]
        }
      }
    },
    {
      "name": "连接 MySQL",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "method": "POST",
        "url": "http://localhost:3000/api/connect",
        "bodyParametersJson": "{\"type\":\"mysql\",\"host\":\"localhost\",\"port\":3306,\"user\":\"root\",\"password\":\"pass\",\"database\":\"source_db\"}"
      }
    },
    {
      "name": "提取数据",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "method": "POST",
        "url": "http://localhost:3000/api/query",
        "bodyParametersJson": "{\"sessionId\":\"{{$node['连接 MySQL'].json.data.sessionId}}\",\"query\":\"SELECT * FROM users WHERE updated_at > NOW() - INTERVAL 1 HOUR\"}"
      }
    },
    {
      "name": "转换数据",
      "type": "n8n-nodes-base.code",
      "parameters": {
        "jsCode": "const rows = $input.all()[0].json.data.rows;\nreturn rows.map(row => ({\n  json: {\n    id: row.id,\n    name: row.name.toUpperCase(),\n    email: row.email.toLowerCase(),\n    created_at: new Date(row.created_at).toISOString()\n  }\n}));"
      }
    },
    {
      "name": "连接 PostgreSQL",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "method": "POST",
        "url": "http://localhost:3000/api/connect",
        "bodyParametersJson": "{\"type\":\"postgres\",\"host\":\"localhost\",\"port\":5432,\"user\":\"postgres\",\"password\":\"pass\",\"database\":\"target_db\",\"allowWrite\":true}"
      }
    },
    {
      "name": "加载数据",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "method": "POST",
        "url": "http://localhost:3000/api/execute",
        "bodyParametersJson": "{\"sessionId\":\"{{$node['连接 PostgreSQL'].json.data.sessionId}}\",\"query\":\"INSERT INTO users (id, name, email, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email\",\"params\":[\"{{$json.id}}\",\"{{$json.name}}\",\"{{$json.email}}\",\"{{$json.created_at}}\"]}"
      }
    }
  ]
}
```

## 资源

- [n8n 文档](https://docs.n8n.io/)
- [API 参考](../http-api/API_REFERENCE.zh-CN.md)
- [部署指南](../http-api/DEPLOYMENT.zh-CN.md)

## 支持

如有集成问题：
- GitHub Issues: https://github.com/Anarkh-Lee/universal-db-mcp/issues
- n8n 社区: https://community.n8n.io/
