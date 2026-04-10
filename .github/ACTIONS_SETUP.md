# GitHub Actions 配置指南

本项目使用 GitHub Actions 实现自动化 CI/CD 流程。

## 📋 工作流说明

### 1. CI 工作流 (`.github/workflows/ci.yml`)

**触发条件**:
- 推送到 `main` 或 `develop` 分支
- 针对 `main` 或 `develop` 分支的 Pull Request

**功能**:
- ✅ 在多个 Node.js 版本（20.x, 22.x）上测试
- ✅ 安装依赖并构建项目
- ✅ 检查 TypeScript 类型
- ✅ 验证构建输出
- ✅ 检查包内容

### 2. NPM 发布工作流 (`.github/workflows/publish.yml`)

**触发条件**:
- 创建 GitHub Release
- 手动触发（workflow_dispatch）

**功能**:
- ✅ 自动构建项目
- ✅ 发布到 NPM
- ✅ 使用 provenance（来源证明）
- ✅ 发布成功/失败通知

## 🔧 配置步骤

### 1. 获取 NPM Token

1. 登录 [npmjs.com](https://www.npmjs.com/)
2. 点击头像 → **Access Tokens**
3. 点击 **Generate New Token** → **Classic Token**
4. 选择 **Automation** 类型
5. 复制生成的 token

### 2. 配置 GitHub Secrets

1. 进入 GitHub 仓库
2. 点击 **Settings** → **Secrets and variables** → **Actions**
3. 点击 **New repository secret**
4. 添加以下 secret:
   - **Name**: `NPM_TOKEN`
   - **Value**: 粘贴你的 NPM token

### 3. 配置 NPM 包权限

确保你的 NPM 账号有权限发布包：

```bash
# 登录 NPM
npm login

# 检查当前用户
npm whoami

# 如果包名已存在，确保你是所有者或协作者
npm owner ls universal-db-mcp
```

### 4. 配置 package.json

确保 `package.json` 中的以下字段正确：

```json
{
  "name": "universal-db-mcp",
  "version": "0.1.1",
  "publishConfig": {
    "access": "public"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/your-username/universal-db-mcp.git"
  }
}
```

## 🚀 发布流程

### 方法 1: 通过 GitHub Release（推荐）

先把代码都commit，然后再开始下面操作

1. **更新版本号**
   ```bash
   # 补丁版本 (0.1.1 -> 0.1.2)
   npm version patch

   # 次要版本 (0.1.1 -> 0.2.0)
   npm version minor

   # 主要版本 (0.1.1 -> 1.0.0)
   npm version major
   ```

2. **推送 tag 到 GitHub**
   ```bash
   git push origin main --tags
   ```

3. **创建 GitHub Release**
   
   - 进入 GitHub 仓库
   - 点击 **Releases** → **Create a new release**
   - 选择刚才创建的 tag
   - 填写 Release 标题和说明
- 点击 **Publish release**
   
4. **自动发布**
   - GitHub Actions 会自动触发
   - 构建并发布到 NPM
   - 查看 Actions 标签页查看进度

### 方法 2: 手动触发

1. 进入 GitHub 仓库
2. 点击 **Actions** 标签
3. 选择 **Publish to NPM** 工作流
4. 点击 **Run workflow**
5. 选择分支并点击 **Run workflow**

## 📝 版本管理最佳实践

### 语义化版本控制

遵循 [Semantic Versioning](https://semver.org/) 规范：

- **MAJOR** (1.0.0): 不兼容的 API 变更
- **MINOR** (0.1.0): 向后兼容的功能新增
- **PATCH** (0.0.1): 向后兼容的问题修复

### 发布前检查清单

- [ ] 代码已合并到 main 分支
- [ ] 所有测试通过
- [ ] 更新了 CHANGELOG.md
- [ ] 更新了文档
- [ ] 版本号已更新
- [ ] 创建了 git tag

### Release Notes 模板

```markdown
## 🎉 v0.2.0

### ✨ 新功能
- 添加 Oracle 数据库支持
- 支持多种连接方式（Easy Connect、TNS）

### 🐛 Bug 修复
- 修复连接超时问题
- 修复列名大小写问题

### 📚 文档更新
- 更新 README.md
- 添加 Oracle 使用示例

### 🔧 其他改进
- 优化错误处理
- 改进类型定义
```

## 🔍 监控发布状态

### 查看 GitHub Actions 日志

1. 进入 GitHub 仓库
2. 点击 **Actions** 标签
3. 选择对应的工作流运行
4. 查看详细日志

### 验证 NPM 发布

```bash
# 查看最新版本
npm view universal-db-mcp version

# 查看包信息
npm view universal-db-mcp

# 安装测试
npm install -g @joyous-coder/universal-db-mcp@latest
universal-db-mcp --version
```

## 🐛 故障排查

### 问题 1: NPM_TOKEN 无效

**错误**: `npm ERR! code E401`

**解决方案**:
1. 检查 NPM token 是否正确
2. 确认 token 类型为 "Automation"
3. 重新生成 token 并更新 GitHub Secret

### 问题 2: 包名冲突

**错误**: `npm ERR! 403 Forbidden`

**解决方案**:
1. 修改 `package.json` 中的包名
2. 或者使用 scoped package: `@your-username/universal-db-mcp`

### 问题 3: 版本已存在

**错误**: `npm ERR! 403 You cannot publish over the previously published versions`

**解决方案**:
1. 更新版本号: `npm version patch`
2. 推送新的 tag: `git push --tags`

### 问题 4: 构建失败

**错误**: TypeScript 编译错误

**解决方案**:
1. 本地运行 `npm run build` 检查错误
2. 修复 TypeScript 错误
3. 提交并重新触发工作流

## 📊 工作流徽章

在 README.md 中添加状态徽章：

```markdown
[![CI](https://github.com/your-username/universal-db-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/your-username/universal-db-mcp/actions/workflows/ci.yml)
[![NPM Version](https://img.shields.io/npm/v/universal-db-mcp.svg)](https://www.npmjs.com/package/universal-db-mcp)
[![NPM Downloads](https://img.shields.io/npm/dm/universal-db-mcp.svg)](https://www.npmjs.com/package/universal-db-mcp)
```

## 🔐 安全最佳实践

1. **保护 NPM Token**
   - 永远不要在代码中硬编码 token
   - 使用 GitHub Secrets 存储敏感信息
   - 定期轮换 token

2. **使用 Provenance**
   - 工作流已配置 `--provenance` 标志
   - 提供包的来源证明
   - 增强供应链安全

3. **限制权限**
   - 工作流使用最小权限原则
   - 仅授予必要的权限

4. **代码审查**
   - 所有变更通过 Pull Request
   - 至少一人审查后合并
   - 使用分支保护规则

## 📚 相关资源

- [GitHub Actions 文档](https://docs.github.com/en/actions)
- [NPM 发布文档](https://docs.npmjs.com/cli/v9/commands/npm-publish)
- [语义化版本控制](https://semver.org/)
- [NPM Provenance](https://docs.npmjs.com/generating-provenance-statements)

---

## 🎉 完成！

配置完成后，每次创建 Release 都会自动发布到 NPM。享受自动化的便利吧！
