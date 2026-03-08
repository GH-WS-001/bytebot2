/**
 * 测试带偏差阈值的坐标修正逻辑
 */

const config = {
  apiMousePosition: { x: 661, y: 517 },
  screenshotMousePosition: { x: 522, y: 553 },
  maxDeviationThreshold: 5
};

const screenshotTargetPosition = { x: 638, y: 522 };

console.log('=== 测试带偏差阈值的坐标修正 ===\n');
console.log('输入数据:');
console.log(`  API 当前鼠标位置: (${config.apiMousePosition.x}, ${config.apiMousePosition.y})`);
console.log(`  截图中鼠标位置: (${config.screenshotMousePosition.x}, ${config.screenshotMousePosition.y})`);
console.log(`  截图中目标位置: (${screenshotTargetPosition.x}, ${screenshotTargetPosition.y})`);
console.log(`  最大偏差阈值: ${config.maxDeviationThreshold} 像素`);
console.log();

// 计算相对偏差
const relativeOffsetX = screenshotTargetPosition.x - config.screenshotMousePosition.x;
const relativeOffsetY = screenshotTargetPosition.y - config.screenshotMousePosition.y;

console.log('初始计算:');
console.log(`  相对偏差 = (${relativeOffsetX}, ${relativeOffsetY})`);
console.log(`  初始修正坐标 = (${config.apiMousePosition.x + relativeOffsetX}, ${config.apiMousePosition.y + relativeOffsetY})`);
console.log();

// 计算距离函数
function calculateDistance(point1, point2) {
  const dx = point1.x - point2.x;
  const dy = point1.y - point2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// 迭代调整
let correctedX = config.apiMousePosition.x + relativeOffsetX;
let correctedY = config.apiMousePosition.y + relativeOffsetY;
let iteration = 0;
const maxIterations = 20;
let currentDeviation = calculateDistance(
  { x: correctedX, y: correctedY },
  screenshotTargetPosition
);

console.log('迭代调整过程:');
console.log(`  初始偏差: ${currentDeviation.toFixed(2)} 像素`);

while (currentDeviation > config.maxDeviationThreshold && iteration < maxIterations) {
  const dx = screenshotTargetPosition.x - correctedX;
  const dy = screenshotTargetPosition.y - correctedY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance > 0) {
    const targetDeviation = config.maxDeviationThreshold - 0.5;
    const moveDistance = Math.min(
      Math.max(currentDeviation - targetDeviation, 0.1),
      distance * 0.8
    );
    correctedX += (dx / distance) * moveDistance;
    correctedY += (dy / distance) * moveDistance;
  }

  currentDeviation = calculateDistance(
    { x: correctedX, y: correctedY },
    screenshotTargetPosition
  );

  iteration++;
  console.log(`  迭代 ${iteration}: 坐标=(${correctedX.toFixed(2)}, ${correctedY.toFixed(2)}), 偏差=${currentDeviation.toFixed(2)} 像素`);
}

const finalX = Math.round(correctedX);
const finalY = Math.round(correctedY);
const finalDeviation = calculateDistance(
  { x: finalX, y: finalY },
  screenshotTargetPosition
);

console.log();
console.log('最终结果:');
console.log(`  最终坐标: (${finalX}, ${finalY})`);
console.log(`  最终偏差: ${finalDeviation.toFixed(2)} 像素`);
console.log(`  是否满足阈值要求: ${finalDeviation <= config.maxDeviationThreshold ? '✓ 是' : '✗ 否'}`);
console.log(`  迭代次数: ${iteration}`);
