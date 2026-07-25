# AWS Lambda 部署

本文档介绍如何将 Universal DB MCP 部署到 AWS Lambda。

## 前置要求

- AWS 账号
- 安装 [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html)
- 配置 AWS 凭证

## 部署步骤

### 1. 安装 AWS SAM CLI

```bash
# macOS
brew install aws-sam-cli

# Windows
# 下载 MSI 安装包：https://github.com/aws/aws-sam-cli/releases

# Linux
pip install aws-sam-cli
```

### 2. 配置 AWS 凭证

```bash
aws configure
```

### 3. 进入部署目录

```bash
cd serverless/aws-lambda
```

### 4. 修改配置

编辑 `template.yaml`：

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: Universal DB MCP HTTP API

Globals:
  Function:
    Timeout: 60
    MemorySize: 512
    Runtime: nodejs20.x

Resources:
  UniversalDbMcpFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: ../../
      Handler: dist/http/http-index.handler
      Environment:
        Variables:
          MODE: http
          API_KEYS: !Ref ApiKeys
      Events:
        Api:
          Type: HttpApi
          Properties:
            Path: /{proxy+}
            Method: ANY

Parameters:
  ApiKeys:
    Type: String
    Description: API Keys for authentication
    NoEcho: true

Outputs:
  ApiEndpoint:
    Description: API Gateway endpoint URL
    Value: !Sub "https://${ServerlessHttpApi}.execute-api.${AWS::Region}.amazonaws.com"
```

### 5. 构建

```bash
sam build
```

### 6. 部署

```bash
sam deploy --guided
```

按提示输入：
- Stack Name: `universal-db-mcp`
- AWS Region: 选择你的区域
- ApiKeys: 输入你的 API 密钥

### 7. 获取访问地址

部署成功后会显示 API Gateway 端点地址。

## 配置说明

### 内存配置

- 轻量使用：256MB
- 一般使用：512MB
- 重度使用：1024MB

### 超时配置

- API Gateway 最大超时：29 秒
- Lambda 最大超时：15 分钟

### VPC 配置

连接 VPC 内数据库：

```yaml
Resources:
  UniversalDbMcpFunction:
    Properties:
      # ... 其他配置 ...
      VpcConfig:
        SecurityGroupIds:
          - sg-xxx
        SubnetIds:
          - subnet-xxx
```

### RDS 代理

推荐使用 RDS Proxy 管理数据库连接：

```yaml
Resources:
  RdsProxy:
    Type: AWS::RDS::DBProxy
    Properties:
      DBProxyName: universal-db-mcp-proxy
      EngineFamily: MYSQL
      # ... 其他配置 ...
```

## 注意事项

1. **冷启动** - Lambda 有冷启动延迟，可使用预置并发
2. **连接管理** - 使用 RDS Proxy 避免连接耗尽
3. **超时** - API Gateway 有 29 秒超时限制
4. **日志** - 使用 CloudWatch Logs 查看日志

## 费用说明

AWS Lambda 按请求数和执行时间计费：

- 请求数：每月前 100 万次免费
- 执行时间：每月前 40 万 GB-秒免费

详细价格请参考 [AWS Lambda 定价](https://aws.amazon.com/lambda/pricing/)。

## 相关链接

- [AWS Lambda 文档](https://docs.aws.amazon.com/lambda/)
- [AWS SAM 文档](https://docs.aws.amazon.com/serverless-application-model/)
- [RDS Proxy 文档](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html)
