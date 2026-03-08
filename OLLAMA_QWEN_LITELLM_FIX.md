# Ollama Qwen 模型与 litellm 集成问题分析

## 📋 问题描述

使用 `anthropic/qwen3.5:35b` 配置时，litellm 报错：
```
TypeError: 'NoneType' object is not iterable
File "/usr/lib/python3.13/site-packages/litellm/llms/anthropic/chat/transformation.py", line 1449, in extract_response_content
    for idx, content in enumerate(completion_response["content"]):
```

## 🔍 问题根源

### litellm 的工作流程

1. **接收 Ollama 响应**:
```json
{
  "id": "chatcmpl-xxx",
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "some text or null",
      "tool_calls": [...]
    }
  }]
}
```

2. **litellm 尝试转换为 Anthropic 格式**:
```python
# litellm/llms/anthropic/chat/transformation.py:1449
for idx, content in enumerate(completion_response["content"]):
    # 期望 content 是一个数组，但实际是 None 或字符串
```

3. **失败原因**:
- Anthropic 格式期望 `content` 是一个数组：`[{"type": "text", "text": "..."}]`
- Ollama 返回的 `content` 可能是 `null` 或字符串
- litellm 的转换逻辑没有正确处理这种情况

## 💡 解决方案

### 方案 1: 修改 litellm 配置（已尝试，不推荐）

使用 `openai/` 前缀：
```yaml
model: openai/qwen3.5:35b
```

**问题**: 会导致 `<nli>` 标签错误

### 方案 2: 使用 anthropic/ 前缀 + 修复 litellm（推荐）

保持使用 `anthropic/` 前缀，但需要修复 litellm 的响应处理。

#### 2.1 检查 litellm 版本

```bash
docker exec bytebot-llm-proxy pip show litellm
```

#### 2.2 升级 litellm 到最新版本

修改 `packages/bytebot-llm-proxy/requirements.txt`:
```
litellm>=1.50.0
```

#### 2.3 添加自定义响应处理器

创建自定义的 litellm 配置来处理 Ollama 响应。

### 方案 3: 绕过 litellm 直接调用 Ollama（备选）

如果 litellm 问题无法解决，可以考虑直接调用 Ollama API。

## 🛠️ 当前实现

### 1. litellm 配置

```yaml
model_list:
  - model_name: qwen3.5:35b
    litellm_params:
      model: anthropic/qwen3.5:35b
      api_base: http://169.254.79.23:11434/v1
      drop_params: true
```

### 2. 增强的响应处理

在 `proxy.service.ts` 中：
- 检测空响应
- 自动使用 `reasoning` 字段
- 详细的调试日志

### 3. 错误处理

在 `formatChatCompletionResponse` 中：
- 验证 message 结构
- 处理空 content
- 添加占位符文本

## 📊 问题分析

### litellm 的 Anthropic 转换器期望的格式

```json
{
  "content": [
    {"type": "text", "text": "response text"},
    {"type": "tool_use", "name": "tool_name", "input": {...}}
  ]
}
```

### Ollama 实际返回的格式

```json
{
  "content": "response text or null",
  "tool_calls": [
    {"id": "xxx", "type": "function", "function": {"name": "tool_name", "arguments": "{...}"}}
  ]
}
```

### 转换失败的原因

litellm 的 `extract_response_content` 函数：
```python
def extract_response_content(completion_response):
    # 期望 completion_response["content"] 是一个可迭代的数组
    for idx, content in enumerate(completion_response["content"]):
        # 但实际是 None 或字符串，导致 TypeError
```

## 🎯 推荐的解决步骤

### 步骤 1: 检查 litellm 日志

```bash
docker compose -f docker/docker-compose.proxy.yml logs bytebot-llm-proxy | grep -A 10 "extract_response_content"
```

### 步骤 2: 升级 litellm

```bash
# 修改 requirements.txt
echo "litellm>=1.50.0" > packages/bytebot-llm-proxy/requirements.txt

# 重新构建
docker compose -f docker/docker-compose.proxy.yml build bytebot-llm-proxy
```

### 步骤 3: 添加环境变量

在 `docker/docker-compose.proxy.yml` 中添加：
```yaml
environment:
  - LITELLM_LOG=DEBUG
  - ANTHROPIC_API_KEY=dummy  # 添加一个假的 API key
```

### 步骤 4: 使用 fallback 模型

如果问题持续，考虑使用 fallback：
```yaml
model_list:
  - model_name: qwen3.5:35b
    litellm_params:
      model: anthropic/qwen3.5:35b
      api_base: http://169.254.79.23:11434/v1
      drop_params: true
    model_info:
      supports_function_calling: true

litellm_settings:
  fallbacks: [{"qwen3.5:35b": ["gpt-4o"]}]
```

## 📝 临时解决方案

### 选项 A: 使用其他模型

临时切换到其他模型进行测试：
```yaml
model: openai/gpt-4o
# 或
model: anthropic/claude-3-sonnet-20240229
```

### 选项 B: 修改 Ollama 模型

尝试使用其他 Ollama 模型：
```yaml
model: anthropic/llama3.1:70b
```

## 🔗 相关资源

- [litellm 文档](https://docs.litellm.ai/)
- [Ollama API 文档](https://github.com/ollama/ollama/blob/main/docs/api.md)
- [Anthropic API 文档](https://docs.anthropic.com/claude/reference)

## 📞 下一步行动

1. **立即**: 检查 litellm 版本和日志
2. **短期**: 升级 litellm 或添加自定义处理器
3. **长期**: 考虑直接集成 Ollama 或使用其他代理方案

---

**创建日期**: 2026-03-08
**状态**: 待解决
**优先级**: 高
