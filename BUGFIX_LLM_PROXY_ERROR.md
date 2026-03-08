# LLM Proxy 错误修复说明

## 问题描述

在使用 Docker 中的 agent 时，出现了以下错误：

```
TypeError: 'NoneType' object is not iterable
```

错误发生在 litellm 的 Anthropic 响应转换层，具体位置：
- `/usr/lib/python3.13/site-packages/litellm/llms/anthropic/chat/transformation.py:1449`
- 错误原因：`completion_response["content"]` 为 `None`

## 根本原因

### 1. 模型配置错误
- **错误配置**：使用 `anthropic/qwen3.5:35b` 模型
- **正确配置**：应该使用 `openai/qwen3.5:35b`（Ollama 本地模型）
- **影响**：litellm 尝试用 Anthropic 的响应格式来解析 Ollama 的响应，导致 `content` 字段为 `None`

### 2. 缺少响应验证
- `proxy.service.ts` 中的 `formatChatCompletionResponse` 方法没有对空响应进行验证
- 当收到无效或空的响应时，没有适当的错误处理

## 修复方案

### 修复 1：更新 litellm 配置文件

**文件**：`packages/bytebot-llm-proxy/litellm-config.yaml`

**修改内容**：
```yaml
# 在 qwen3.5:35b 模型配置中添加 drop_params 参数
- model_name: qwen3.5:35b
  litellm_params:
    model: openai/qwen3.5:35b
    api_base: http://169.254.79.23:11434/v1
    drop_params: true  # 新增：丢弃 Anthropic 特定参数
```

**说明**：`drop_params: true` 参数会自动丢弃不适用于 Ollama 的 Anthropic 特定参数，避免格式不匹配。

### 修复 2：增强响应验证

**文件**：`packages/bytebot-agent/src/proxy/proxy.service.ts`

**修改内容**：在 `formatChatCompletionResponse` 方法中添加了两处验证：

1. **消息结构验证**：
```typescript
// Validate message structure
if (!message) {
  this.logger.error('Received null or undefined message from LLM');
  throw new Error('Invalid response: message is null or undefined');
}
```

2. **空响应处理**：
```typescript
// Validate that we have at least some content
if (contentBlocks.length === 0) {
  this.logger.warn(
    'Received empty response from LLM, adding placeholder text',
  );
  contentBlocks.push({
    type: MessageContentType.Text,
    text: '(No response content)',
  } as TextContentBlock);
}
```

## 部署步骤

1. **重启 litellm-proxy 服务**：
```bash
docker-compose restart bytebot-llm-proxy
```

2. **重新构建并重启 bytebot-agent**：
```bash
docker-compose up -d --build bytebot-agent
```

3. **验证修复**：
- 检查日志是否还有 `TypeError: 'NoneType' object is not iterable` 错误
- 确认 agent 能够正常处理 LLM 响应

## 预防措施

1. **模型配置检查**：
   - 确保所有模型配置使用正确的提供商前缀（`anthropic/`、`openai/`、`gemini/` 等）
   - 对于 Ollama 本地模型，始终使用 `openai/` 前缀
   - 添加 `drop_params: true` 参数以避免参数冲突

2. **错误处理**：
   - 所有 LLM 响应处理都应包含空值检查
   - 添加详细的日志记录以便调试
   - 提供合理的默认值或错误消息

3. **测试建议**：
   - 在部署前测试所有配置的模型
   - 验证不同模型的响应格式兼容性
   - 模拟各种错误场景（网络错误、空响应等）

## 相关文件

- `packages/bytebot-llm-proxy/litellm-config.yaml` - LLM 模型配置
- `packages/bytebot-agent/src/proxy/proxy.service.ts` - LLM 代理服务
- `packages/bytebot-agent/src/proxy/proxy.tools.ts` - 工具定义

## 技术细节

### litellm 模型提供商前缀

| 提供商 | 前缀 | 示例 |
|--------|------|------|
| Anthropic | `anthropic/` | `anthropic/claude-3-opus-20240229` |
| OpenAI | `openai/` | `openai/gpt-4-turbo-preview` |
| Ollama | `openai/` | `openai/qwen3.5:35b` |
| Gemini | `gemini/` | `gemini/gemini-pro` |

### 响应格式差异

不同 LLM 提供商的响应格式存在差异：

- **Anthropic 格式**：包含 `content` 数组，每个元素可以是文本、图片、工具调用等
- **OpenAI 格式**：`content` 为字符串或 null，工具调用在 `tool_calls` 字段
- **Ollama 格式**：兼容 OpenAI 格式，但可能包含额外字段如 `reasoning`

`drop_params: true` 参数确保 litellm 只发送目标提供商支持的参数。

## 联系方式

如有问题，请检查：
1. Docker 日志：`docker-compose logs -f bytebot-agent`
2. litellm 日志：`docker-compose logs -f bytebot-llm-proxy`
3. 环境变量配置：确保所有 API 密钥已正确设置
