# 腾讯云函数部署

本文档介绍如何将 Universal DB MCP 部署到腾讯云云函数（SCF）。

## 前置要求

- 腾讯云账号
- 安装 [Serverless Framework](https://www.serverless.com/)
- 配置腾讯云凭证

## 部署步骤

### 1. 安装 Serverless Framework

```bash
npm install -g serverless
```

### 2. 进入部署目录

```bash
cd serverless/tencent-scf
```

### 3. 修改配置

编辑 `serverless.yml`：

```yaml
component: scf
name: universal-db-mcp
app: universal-db-mcp

inputs:
  name: universal-db-mcp
  src:
    src: ../../
    exclude:
      - .git/**
      - node_modules/**
      - tests/**
  handler: dist/http/http-index.handler
  runtime: Nodejs20.15
  region: ap-guangzhou  # 修改为你的区域
  memorySize: 512
  timeout: 60
  environment:
    variables:
      MODE: http
      API_KEYS: ${env:API_KEYS}
  events:
    - apigw:
        parameters:
          protocols:
            - http
            - https
          environment: release
          endpoints:
            - path: /
              method: ANY
```

### 4. 设置环境变量

```bash
export API_KEYS=your-secret-key
```

### 5. 部署

```bash
serverless deploy
```

### 6. 获取访问地址

部署成功后会显示 API 网关地址。

## 配置说明

### 内存配置

- 轻量使用：256MB
- 一般使用：512MB
- 重度使用：1024MB

### 超时配置

- 简单查询：30 秒
- 复杂查询：60 秒
- 大数据量：120 秒（最大 900 秒）

### VPC 配置

连接 VPC 内数据库：

```yaml
inputs:
  # ... 其他配置 ...
  vpcConfig:
    vpcId: vpc-xxx
    subnetId: subnet-xxx
```

## 注意事项

1. **冷启动** - 首次请求有冷启动延迟
2. **并发限制** - 默认并发限制 300，可申请提升
3. **日志** - 使用腾讯云日志服务查看
4. **监控** - 在云函数控制台查看监控指标

## 费用说明

腾讯云云函数按调用次数和资源使用量计费：

- 调用次数：每月前 100 万次免费
- 资源使用：每月前 40 万 GB-秒免费

详细价格请参考 [腾讯云云函数定价](https://cloud.tencent.com/document/product/583/12284)。

## 相关链接

- [腾讯云云函数文档](https://cloud.tencent.com/document/product/583)
- [Serverless Framework 文档](https://www.serverless.com/framework/docs)
