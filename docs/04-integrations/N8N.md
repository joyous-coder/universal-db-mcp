# n8n Integration Guide

This guide shows how to integrate Universal Database MCP Server with n8n workflow automation platform.

## Overview

n8n is a workflow automation tool. By integrating Universal Database MCP Server, you can create workflows that query and manipulate database data.

## Prerequisites

- Universal Database MCP Server deployed with HTTP API mode
- n8n instance (self-hosted or cloud)
- Database instance (MySQL, PostgreSQL, etc.)

## Setup Steps

### Step 1: Deploy HTTP API Server

Deploy Universal Database MCP Server:

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

### Step 2: Create n8n Workflow

1. Login to n8n
2. Click "New Workflow"
3. Name your workflow (e.g., "Database Query Workflow")

### Step 3: Add HTTP Request Nodes

n8n uses HTTP Request nodes to call APIs. Add nodes for each operation:

#### Node 1: Connect to Database

**Node Type**: HTTP Request
**Name**: `Connect Database`

**Settings**:
- **Method**: POST
- **URL**: `http://localhost:3000/api/connect`
- **Authentication**: Generic Credential Type
  - Header Auth
  - Name: `X-API-Key`
  - Value: `n8n-secret-key`
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

**Output**: Extracts `sessionId` from response

#### Node 2: Execute Query

**Node Type**: HTTP Request
**Name**: `Execute Query`

**Settings**:
- **Method**: POST
- **URL**: `http://localhost:3000/api/query`
- **Authentication**: Header Auth (X-API-Key)
- **Body**:
```json
{
  "sessionId": "{{$node['Connect Database'].json.data.sessionId}}",
  "query": "SELECT * FROM users LIMIT 10"
}
```

#### Node 3: Process Results

**Node Type**: Code
**Name**: `Process Results`

**Code**:
```javascript
const results = $input.all()[0].json.data.rows;

return results.map(row => ({
  json: row
}));
```

## Example Workflows

### Workflow 1: Scheduled Database Backup

**Trigger**: Schedule (daily at 2 AM)

**Nodes**:
1. **Schedule Trigger** - Runs daily at 2 AM
2. **Connect Database** - Connects to database
3. **Execute Query** - `SELECT * FROM users`
4. **Convert to CSV** - Converts results to CSV
5. **Send Email** - Emails CSV file
6. **Disconnect Database** - Closes connection

**n8n Workflow JSON**:
```json
{
  "nodes": [
    {
      "parameters": {
        "rule": {
          "interval": [
            {
              "field": "hours",
              "hoursInterval": 24
            }
          ]
        }
      },
      "name": "Schedule Trigger",
      "type": "n8n-nodes-base.scheduleTrigger",
      "position": [250, 300]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "http://localhost:3000/api/connect",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "options": {},
        "bodyParametersJson": "{\n  \"type\": \"mysql\",\n  \"host\": \"localhost\",\n  \"port\": 3306,\n  \"user\": \"root\",\n  \"password\": \"password\",\n  \"database\": \"testdb\"\n}"
      },
      "name": "Connect Database",
      "type": "n8n-nodes-base.httpRequest",
      "position": [450, 300]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "http://localhost:3000/api/query",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "bodyParametersJson": "{\n  \"sessionId\": \"{{$node['Connect Database'].json.data.sessionId}}\",\n  \"query\": \"SELECT * FROM users\"\n}"
      },
      "name": "Execute Query",
      "type": "n8n-nodes-base.httpRequest",
      "position": [650, 300]
    }
  ]
}
```

### Workflow 2: Webhook to Database

**Trigger**: Webhook

**Nodes**:
1. **Webhook** - Receives HTTP POST
2. **Connect Database** - Connects to database
3. **Execute Query** - Inserts data from webhook
4. **Respond to Webhook** - Returns success/error
5. **Disconnect Database** - Closes connection

**Example**:
```bash
# Trigger workflow
curl -X POST https://your-n8n.com/webhook/insert-user \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alice",
    "email": "alice@example.com"
  }'
```

**Query Node**:
```json
{
  "sessionId": "{{$node['Connect Database'].json.data.sessionId}}",
  "query": "INSERT INTO users (name, email) VALUES (?, ?)",
  "params": [
    "{{$json.name}}",
    "{{$json.email}}"
  ]
}
```

### Workflow 3: Data Sync Between Databases

**Trigger**: Schedule (every hour)

**Nodes**:
1. **Schedule Trigger** - Runs hourly
2. **Connect Source DB** - Connects to source database
3. **Query Source** - Gets new records
4. **Connect Target DB** - Connects to target database
5. **Insert to Target** - Inserts records
6. **Disconnect Both** - Closes connections

### Workflow 4: Database Monitoring

**Trigger**: Schedule (every 5 minutes)

**Nodes**:
1. **Schedule Trigger** - Runs every 5 minutes
2. **Connect Database** - Connects to database
3. **Check Table Size** - `SELECT COUNT(*) FROM users`
4. **Check Slow Queries** - Queries performance schema
5. **Send Alert** - Sends Slack/email if threshold exceeded
6. **Disconnect Database** - Closes connection

## Advanced Patterns

### Pattern 1: Dynamic Query Builder

Use n8n's Code node to build queries dynamically:

```javascript
// Code node
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

### Pattern 2: Batch Processing

Process large datasets in batches:

```javascript
// Code node
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

### Pattern 3: Error Handling

Implement robust error handling:

```javascript
// Code node
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

### Pattern 4: Connection Pooling

Reuse connections across workflow executions:

```javascript
// Use n8n's static data to store session ID
const staticData = this.getWorkflowStaticData('global');

if (!staticData.sessionId) {
  // Connect to database
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

## Integration with Other n8n Nodes

### With Google Sheets

**Workflow**: Database → Google Sheets

1. Query database
2. Format results
3. Write to Google Sheets

### With Slack

**Workflow**: Database Alert → Slack

1. Query database for metrics
2. Check thresholds
3. Send Slack message if alert

### With Airtable

**Workflow**: Database → Airtable Sync

1. Query database
2. Transform data
3. Update Airtable records

### With Email

**Workflow**: Database Report → Email

1. Query database
2. Generate HTML report
3. Send email with report

## Best Practices

### 1. Use Credentials

Store API keys in n8n credentials:

1. Go to Credentials
2. Create new "Header Auth" credential
3. Name: `X-API-Key`
4. Value: Your API key
5. Use in HTTP Request nodes

### 2. Error Handling

Add error handling to all workflows:

```javascript
// In HTTP Request node settings
// Enable "Continue On Fail"
// Add error handling node
```

### 3. Logging

Log important events:

```javascript
// Code node
console.log('Query executed:', query);
console.log('Results:', results.length, 'rows');
```

### 4. Testing

Test workflows before production:

1. Use test database
2. Test with small datasets
3. Verify error handling
4. Check performance

## Monitoring & Debugging

### View Execution Logs

1. Go to "Executions" tab
2. Click on execution
3. View node outputs
4. Check error messages

### Debug Mode

Enable debug mode in n8n:

```bash
# In docker-compose.yml
environment:
  - N8N_LOG_LEVEL=debug
```

### Performance Monitoring

Monitor workflow performance:

1. Check execution time
2. Identify slow nodes
3. Optimize queries
4. Add caching

## Troubleshooting

### Issue: Connection Timeout

**Solution**:
- Increase timeout in HTTP Request node
- Check network connectivity
- Verify API server is running

### Issue: Session Expired

**Solution**:
- Reconnect to database
- Increase session timeout
- Implement connection pooling

### Issue: Large Result Sets

**Solution**:
- Add LIMIT to queries
- Use pagination
- Process in batches

## Example: Complete ETL Workflow

```json
{
  "name": "ETL: MySQL to PostgreSQL",
  "nodes": [
    {
      "name": "Schedule",
      "type": "n8n-nodes-base.scheduleTrigger",
      "parameters": {
        "rule": {
          "interval": [{"field": "hours", "hoursInterval": 1}]
        }
      }
    },
    {
      "name": "Connect MySQL",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "method": "POST",
        "url": "http://localhost:3000/api/connect",
        "bodyParametersJson": "{\"type\":\"mysql\",\"host\":\"localhost\",\"port\":3306,\"user\":\"root\",\"password\":\"pass\",\"database\":\"source_db\"}"
      }
    },
    {
      "name": "Extract Data",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "method": "POST",
        "url": "http://localhost:3000/api/query",
        "bodyParametersJson": "{\"sessionId\":\"{{$node['Connect MySQL'].json.data.sessionId}}\",\"query\":\"SELECT * FROM users WHERE updated_at > NOW() - INTERVAL 1 HOUR\"}"
      }
    },
    {
      "name": "Transform Data",
      "type": "n8n-nodes-base.code",
      "parameters": {
        "jsCode": "const rows = $input.all()[0].json.data.rows;\nreturn rows.map(row => ({\n  json: {\n    id: row.id,\n    name: row.name.toUpperCase(),\n    email: row.email.toLowerCase(),\n    created_at: new Date(row.created_at).toISOString()\n  }\n}));"
      }
    },
    {
      "name": "Connect PostgreSQL",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "method": "POST",
        "url": "http://localhost:3000/api/connect",
        "bodyParametersJson": "{\"type\":\"postgres\",\"host\":\"localhost\",\"port\":5432,\"user\":\"postgres\",\"password\":\"pass\",\"database\":\"target_db\",\"allowWrite\":true}"
      }
    },
    {
      "name": "Load Data",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "method": "POST",
        "url": "http://localhost:3000/api/execute",
        "bodyParametersJson": "{\"sessionId\":\"{{$node['Connect PostgreSQL'].json.data.sessionId}}\",\"query\":\"INSERT INTO users (id, name, email, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email\",\"params\":[\"{{$json.id}}\",\"{{$json.name}}\",\"{{$json.email}}\",\"{{$json.created_at}}\"]}"
      }
    }
  ]
}
```

## Resources

- [n8n Documentation](https://docs.n8n.io/)
- [API Reference](../http-api/API_REFERENCE.md)
- [Deployment Guide](../http-api/DEPLOYMENT.md)

## Support

For integration issues:
- GitHub Issues: https://github.com/Anarkh-Lee/universal-db-mcp/issues
- n8n Community: https://community.n8n.io/
