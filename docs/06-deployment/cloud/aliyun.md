# 阿里云函数计算部署

本文档介绍如何将 Universal DB MCP 部署到阿里云函数计算（FC）。

## 前置要求

- 阿里云账号
- 安装 [Serverless Devs](https://www.serverless-devs.com/)
- 配置阿里云 AccessKey

## 部署步骤

### 1. 安装 Serverless Devs

```bash
npm install -g @serverless-devs/s
```

### 2. 配置阿里云凭证

```bash
s config add
```

选择 `Alibaba Cloud`，输入 AccessKey ID 和 Secret。

### 3. 进入部署目录

```bash
cd serverless/aliyun-fc
```

### 4. 修改配置

编辑 `template.yml`，修改以下配置：

```yaml
edition: 1.0.0
name: universal-db-mcp
access: default

services:
  universal-db-mcp:
    component: fc
    props:
      region: cn-hangzhou  # 修改为你的区域
      service:
        name: universal-db-mcp
        description: Universal DB MCP HTTP API
      function:
        name: api
        runtime: nodejs20
        codeUri: ../../
        handler: dist/http/http-index.handler
        memorySize: 512
        timeout: 60
        environmentVariables:
          MODE: http
          API_KEYS: ${env.API_KEYS}
      triggers:
        - name: http-trigger
          type: http
          config:
            authType: anonymous
            methods:
              - GET
              - POST
              - PUT
              - DELETE
```

### 5. 设置环境变量

```bash
export API_KEYS=your-secret-key
```

### 6. 部署

```bash
s deploy
```

### 7. 获取访问地址

部署成功后会显示函数的 HTTP 触发器地址。

## 配置说明

### 内存配置

根据数据库连接数和查询复杂度调整：

- 轻量使用：256MB
- 一般使用：512MB
- 重度使用：1024MB

### 超时配置

- 简单查询：30 秒
- 复杂查询：60 秒
- 大数据量：120 秒

### VPC 配置

如果需要连接 VPC 内的数据库，需要配置 VPC：

```yaml
function:
  # ... 其他配置 ...
  vpcConfig:
    vpcId: vpc-xxx
    vSwitchIds:
      - vsw-xxx
    securityGroupId: sg-xxx
```

## 注意事项

1. **冷启动** - 函数计算有冷启动延迟，首次请求可能较慢
2. **连接池** - 建议使用连接池管理数据库连接
3. **超时** - 注意函数超时设置，避免长查询被中断
4. **日志** - 使用阿里云日志服务查看函数日志

## 费用说明

阿里云函数计算按调用次数和执行时间计费：

- 调用次数：每月前 100 万次免费
- 执行时间：每月前 40 万 GB-秒免费

详细价格请参考 [阿里云函数计算定价](https://www.aliyun.com/price/product#/fc/detail)。

## 相关链接

- [阿里云函数计算文档](https://help.aliyun.com/product/50980.html)
- [Serverless Devs 文档](https://www.serverless-devs.com/docs)
