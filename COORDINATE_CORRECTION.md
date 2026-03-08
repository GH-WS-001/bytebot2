# 坐标修正功能使用说明

## 概述

坐标修正功能用于解决API鼠标位置和截图鼠标位置之间的偏差问题。当系统检测到截图中的鼠标位置与API报告的鼠标位置不一致时，可以使用此功能对所有目标位置进行修正。

## 计算原理

### 计算过程示例

```
数据源                坐标
API 当前鼠标位置      (661, 517)
截图中鼠标位置        (522, 553)
截图中"更多>>"位置    (638, 522)
偏差 (目标-鼠标)      (116, -31)
最终坐标 (API+偏差)   (777, 486)
```

### 计算步骤

1. **计算相对偏差**：
   ```
   相对偏差 = 截图目标位置 - 截图鼠标位置
   相对偏差 = (638 - 522, 522 - 553) = (116, -31)
   ```

2. **应用修正**：
   ```
   最终坐标 = API鼠标位置 + 相对偏差
   最终坐标 = (661 + 116, 517 + (-31)) = (777, 486)
   ```

## API 使用方法

### 1. 设置坐标修正配置

**请求**：
```http
POST /computer-use/coordinate-correction
Content-Type: application/json

{
  "apiMousePosition": { "x": 661, "y": 517 },
  "screenshotMousePosition": { "x": 522, "y": 553 }
}
```

**响应**：
```json
{
  "success": true,
  "message": "Coordinate correction config set successfully"
}
```

### 2. 清除坐标修正配置

**请求**：
```http
DELETE /computer-use/coordinate-correction
```

**响应**：
```json
{
  "success": true,
  "message": "Coordinate correction config cleared successfully"
}
```

## 使用示例

### JavaScript/TypeScript

```typescript
import { CoordinateCorrectionConfig } from '@bytebot/shared';

// 设置坐标修正
const config: CoordinateCorrectionConfig = {
  apiMousePosition: { x: 661, y: 517 },
  screenshotMousePosition: { x: 522, y: 553 }
};

// 发送请求设置修正配置
await fetch('http://localhost:3000/computer-use/coordinate-correction', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(config)
});

// 之后所有的鼠标移动操作都会自动应用坐标修正
await fetch('http://localhost:3000/computer-use', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'move_mouse',
    coordinates: { x: 638, y: 522 }  // 截图中的目标位置
  })
});
// 实际移动到: (777, 486)

// 清除坐标修正
await fetch('http://localhost:3000/computer-use/coordinate-correction', {
  method: 'DELETE'
});
```

### cURL

```bash
# 设置坐标修正
curl -X POST http://localhost:3000/computer-use/coordinate-correction \
  -H "Content-Type: application/json" \
  -d '{
    "apiMousePosition": {"x": 661, "y": 517},
    "screenshotMousePosition": {"x": 522, "y": 553}
  }'

# 执行鼠标移动（会自动应用修正）
curl -X POST http://localhost:3000/computer-use \
  -H "Content-Type: application/json" \
  -d '{
    "action": "move_mouse",
    "coordinates": {"x": 638, "y": 522}
  }'

# 清除坐标修正
curl -X DELETE http://localhost:3000/computer-use/coordinate-correction
```

## 影响的操作

坐标修正会自动应用到以下所有涉及坐标的操作：

1. **move_mouse** - 移动鼠标到指定位置
2. **trace_mouse** - 沿路径移动鼠标
3. **click_mouse** - 点击指定位置
4. **press_mouse** - 在指定位置按下/释放鼠标
5. **drag_mouse** - 拖拽操作
6. **scroll** - 在指定位置滚动

## 工具函数

### 直接使用工具函数

```typescript
import {
  applyCoordinateCorrection,
  applyCoordinateCorrectionToPath,
  calculateCoordinateOffset,
  CoordinateCorrectionConfig
} from '@bytebot/shared';

const config: CoordinateCorrectionConfig = {
  apiMousePosition: { x: 661, y: 517 },
  screenshotMousePosition: { x: 522, y: 553 }
};

// 修正单个坐标
const targetPosition = { x: 638, y: 522 };
const correctedPosition = applyCoordinateCorrection(targetPosition, config);
console.log(correctedPosition); // { x: 777, y: 486 }

// 修正路径
const path = [
  { x: 638, y: 522 },
  { x: 700, y: 550 },
  { x: 750, y: 600 }
];
const correctedPath = applyCoordinateCorrectionToPath(path, config);
console.log(correctedPath);
// [
//   { x: 777, y: 486 },
//   { x: 839, y: 514 },
//   { x: 889, y: 564 }
// ]

// 计算偏差
const offset = calculateCoordinateOffset(config);
console.log(offset); // { x: -139, y: 36 }
```

## 注意事项

1. **修正配置是全局的**：设置后会影响所有后续的鼠标操作，直到清除配置或重新设置。

2. **修正仅适用于坐标**：不会影响键盘操作、等待时间等其他操作。

3. **性能影响**：坐标修正计算非常轻量，对性能影响可忽略不计。

4. **日志记录**：所有修正操作都会在日志中记录，便于调试和追踪。

5. **测试验证**：建议在使用前运行测试验证修正逻辑的正确性：
   ```bash
   cd packages/shared
   npx ts-node src/utils/coordinateCorrection.test.ts
   ```

## 故障排查

### 问题：修正后坐标仍然不准确

**可能原因**：
- API鼠标位置或截图鼠标位置测量不准确
- 截图和API调用之间存在时间差，鼠标位置发生了变化

**解决方法**：
- 确保在截图后立即获取API鼠标位置
- 多次测量取平均值
- 检查日志中的修正前后坐标对比

### 问题：修正配置未生效

**可能原因**：
- 未正确设置修正配置
- 服务重启后配置丢失

**解决方法**：
- 检查API响应确认设置成功
- 服务重启后需要重新设置修正配置

## 技术实现

### 核心文件

1. **工具函数**：`packages/shared/src/utils/coordinateCorrection.utils.ts`
   - `calculateCoordinateOffset()` - 计算坐标偏差
   - `applyCoordinateCorrection()` - 应用坐标修正
   - `applyCoordinateCorrectionToPath()` - 批量修正路径

2. **服务层**：`packages/bytebotd/src/computer-use/computer-use.service.ts`
   - `setCoordinateCorrection()` - 设置修正配置
   - `clearCoordinateCorrection()` - 清除修正配置
   - `applyCorrectionIfNeeded()` - 应用修正（内部方法）
   - `applyCorrectionToPathIfNeeded()` - 应用路径修正（内部方法）

3. **控制器**：`packages/bytebotd/src/computer-use/computer-use.controller.ts`
   - `POST /computer-use/coordinate-correction` - 设置修正配置
   - `DELETE /computer-use/coordinate-correction` - 清除修正配置

### 修正流程

```
1. 接收目标坐标
   ↓
2. 检查是否设置了修正配置
   ↓ (是)
3. 计算相对偏差
   ↓
4. 应用修正得到最终坐标
   ↓
5. 使用修正后的坐标执行操作
```
