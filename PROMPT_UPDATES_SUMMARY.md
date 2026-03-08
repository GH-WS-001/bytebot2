# 提示词和描述更新总结

## 📋 概述

本文档总结了将目标位置从中心点改为边界框方式时，所有需要更新的提示词和描述。

## ✅ 已完成的更新

### 1. 系统提示词更新

**文件**: `packages/bytebot-agent/src/agent/agent.constants.ts`
**位置**: 行 48

**更新内容**:
```typescript
// 修改前
• **CRITICAL**: When calling any mouse action (computer_move_mouse, computer_click_mouse, computer_press_mouse, computer_drag_mouse, computer_scroll), you MUST include a "targetDescription" field that clearly describes the UI element you intend to interact with. For example: "the blue 'Login' button", "the verification code input box", "the Firefox icon". This description is crucial for visual verification during mouse movement.

// 修改后
• **CRITICAL**: When calling any mouse action (computer_move_mouse, computer_click_mouse, computer_press_mouse, computer_drag_mouse, computer_scroll), you MUST include a "targetDescription" field that clearly describes the UI element you intend to interact with. For example: "the blue 'Login' button", "the verification code input box", "the Firefox icon". This description is used to visually identify the target element's bounding box (x, y, width, height) during mouse movement for precise positioning.
```

**关键变化**:
- ✅ 更新了 `targetDescription` 的用途说明
- ✅ 明确说明用于识别目标元素的边界框
- ✅ 强调精确定位的重要性

---

### 2. 工具定义描述更新

**文件**: `packages/bytebot-agent/src/agent/agent.tools.ts`

#### 2.1 computer_move_mouse 工具
**位置**: 行 47

**更新内容**:
```typescript
// 修改前
description: 'A concise description of the UI element to move to (e.g., "the blue Login button", "the verification code input box"). Used for visual verification during mouse movement.'

// 修改后
description: 'A concise description of the UI element to move to (e.g., "the blue Login button", "the verification code input box"). Used to visually identify the target element\'s bounding box (x, y, width, height) for precise positioning during mouse movement.'
```

#### 2.2 computer_click_mouse 工具
**位置**: 行 93

**更新内容**:
```typescript
// 修改前
description: 'A concise description of the UI element to click (e.g., "the blue Login button", "the verification code input box"). Used for visual verification during mouse movement.'

// 修改后
description: 'A concise description of the UI element to click (e.g., "the blue Login button", "the verification code input box"). Used to visually identify the target element\'s bounding box (x, y, width, height) for precise positioning during mouse movement.'
```

**关键变化**:
- ✅ 更新了 `targetDescription` 参数的描述
- ✅ 明确说明用于识别边界框
- ✅ 强调精确定位

---

### 3. LLM 分析提示词更新

**文件**: `packages/bytebot-agent/src/agent/agent.computer-use.ts`
**位置**: 行 189-196

**更新内容**:
```typescript
// 修改前
text: `Analyze this screenshot and identify two positions:

  1. Mouse Cursor Position: Find the mouse cursor icon (small arrow/pointer). Give me its exact pixel coordinates (center of the cursor).

  2. Target Element Position: ${targetDescription}

  IMPORTANT: You must respond with ONLY a single JSON object, no other text, no markdown, no newlines. The JSON must exactly follow this format:
  {"mousePosition":{"x":100,"y":200},"targetPosition":{"x":300,"y":400},"confidence":"high"}`,

// 修改后
text: `Analyze this screenshot and identify two positions:

  1. Mouse Cursor Position: Find the mouse cursor icon (small arrow/pointer). Give me its exact pixel coordinates (center of the cursor).

  2. Target Element Position: ${targetDescription} Provide the bounding box of the target element (x, y coordinates of top-left corner, width, and height).

  IMPORTANT: You must respond with ONLY a single JSON object, no other text, no markdown, no newlines. The JSON must exactly follow this format:
  {"mousePosition":{"x":100,"y":200},"targetPosition":{"x":300,"y":400,"width":100,"height":50},"confidence":"high"}`,
```

**关键变化**:
- ✅ 要求 LLM 返回边界框格式（x, y, width, height）
- ✅ 明确说明需要提供目标元素的区域范围
- ✅ 更新了返回格式示例

---

## 📊 更新对比表

| 位置 | 文件 | 修改类型 | 关键变化 |
|------|------|---------|---------|
| 行 48 | `agent.constants.ts` | 系统提示词 | 更新 `targetDescription` 用途说明 |
| 行 47 | `agent.tools.ts` | 工具定义 | 更新 `computer_move_mouse` 描述 |
| 行 93 | `agent.tools.ts` | 工具定义 | 更新 `computer_click_mouse` 描述 |
| 行 189-196 | `agent.computer-use.ts` | LLM 提示词 | 要求返回边界框格式 |

---

## 🎯 更新目标

所有更新都围绕以下目标：

1. **准确性**: 明确说明使用边界框而不是单点
2. **清晰性**: 让 LLM 和用户都清楚新的定位方式
3. **一致性**: 所有相关的提示词和描述保持一致
4. **向后兼容**: 代码层面支持旧格式，但提示词引导使用新格式

---

## 🔄 影响范围

### 直接影响
- ✅ LLM 会收到更清晰的指令，返回边界框格式
- ✅ 系统日志会显示完整的边界框信息
- ✅ 用户可以更准确地描述目标元素

### 间接影响
- ✅ 提高目标定位的精确度
- ✅ 改善调试体验
- ✅ 为未来功能扩展奠定基础

---

## 🧪 验证建议

### 1. 检查 LLM 响应格式
```bash
# 查看日志中的 LLM 响应
docker-compose logs -f bytebot-agent | grep "LiteLLM response"
```

**期望输出**:
```json
{
  "mousePosition": {"x": 100, "y": 200},
  "targetPosition": {"x": 300, "y": 400, "width": 100, "height": 50},
  "confidence": "high"
}
```

### 2. 检查边界框信息
```bash
# 查看边界框日志
docker-compose logs -f bytebot-agent | grep "Target bounding box"
```

**期望输出**:
```
Iteration 1: Target bounding box: x=300, y=400, width=100, height=50
```

### 3. 测试不同场景
- 测试按钮点击
- 测试链接点击
- 测试表单输入框
- 测试图片点击

---

## 📝 注意事项

1. **LLM 理解**: 确保 LLM 理解边界框的概念
2. **格式解析**: 系统会自动处理边界框和单点两种格式
3. **日志记录**: 边界框信息会被记录到日志中便于调试
4. **向后兼容**: 旧的单点格式仍然被支持

---

## 🔗 相关文档

- `BOUNDING_BOX_IMPLEMENTATION.md` - 完整的实现说明
- `packages/bytebot-agent/src/agent/agent.computer-use.ts` - 主要实现文件
- `packages/shared/src/utils/coordinateCorrection.utils.ts` - 坐标修正工具

---

## ✅ 检查清单

部署前请确认：

- [x] 系统提示词已更新
- [x] 工具定义描述已更新
- [x] LLM 分析提示词已更新
- [x] 文档已更新
- [x] 代码已构建
- [ ] 服务已重启
- [ ] 日志验证通过
- [ ] 功能测试通过

---

## 🚀 部署步骤

1. **构建代码**
```bash
cd packages/bytebot-agent
npm run build
```

2. **重启服务**
```bash
docker-compose restart bytebot-agent
```

3. **验证更新**
```bash
# 检查日志
docker-compose logs -f bytebot-agent

# 测试功能
# 运行一个包含鼠标操作的任务
```

4. **监控性能**
- 观察 LLM 响应格式
- 检查边界框识别准确性
- 验证目标定位精度

---

## 📞 支持

如有问题或需要进一步的帮助，请参考：
- `BOUNDING_BOX_IMPLEMENTATION.md` - 详细的技术文档
- 项目 Issue 追踪器
- 开发团队联系信息
