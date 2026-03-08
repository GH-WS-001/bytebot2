import {
  calculateCoordinateOffset,
  applyCoordinateCorrection,
  applyCoordinateCorrectionToPath,
  CoordinateCorrectionConfig,
} from './coordinateCorrection.utils';

/**
 * 测试坐标修正逻辑
 * 
 * 根据用户提供的计算过程：
 * 数据源                坐标
 * API 当前鼠标位置      (661, 517)
 * 截图中鼠标位置        (522, 553)
 * 截图中"更多>>"位置    (638, 522)
 * 偏差 (目标-鼠标)      (116, -31)
 * 最终坐标 (API+偏差)   (777, 486)
 */
function testCoordinateCorrection() {
  console.log('=== 测试坐标修正逻辑 ===\n');

  // 测试数据
  const config: CoordinateCorrectionConfig = {
    apiMousePosition: { x: 661, y: 517 },
    screenshotMousePosition: { x: 522, y: 553 },
  };

  const screenshotTargetPosition = { x: 638, y: 522 };

  console.log('输入数据:');
  console.log(`  API 当前鼠标位置: (${config.apiMousePosition.x}, ${config.apiMousePosition.y})`);
  console.log(`  截图中鼠标位置: (${config.screenshotMousePosition.x}, ${config.screenshotMousePosition.y})`);
  console.log(`  截图中目标位置: (${screenshotTargetPosition.x}, ${screenshotTargetPosition.y})`);
  console.log();

  // 计算偏差
  const offset = calculateCoordinateOffset(config);
  console.log('计算偏差:');
  console.log(`  偏差 = 截图鼠标位置 - API鼠标位置`);
  console.log(`  偏差 = (${config.screenshotMousePosition.x} - ${config.apiMousePosition.x}, ${config.screenshotMousePosition.y} - ${config.apiMousePosition.y})`);
  console.log(`  偏差 = (${offset.x}, ${offset.y})`);
  console.log();

  // 应用修正
  const correctedPosition = applyCoordinateCorrection(screenshotTargetPosition, config);
  
  console.log('应用修正:');
  console.log(`  相对偏差 = 目标位置 - 截图鼠标位置`);
  const relativeOffsetX = screenshotTargetPosition.x - config.screenshotMousePosition.x;
  const relativeOffsetY = screenshotTargetPosition.y - config.screenshotMousePosition.y;
  console.log(`  相对偏差 = (${screenshotTargetPosition.x} - ${config.screenshotMousePosition.x}, ${screenshotTargetPosition.y} - ${config.screenshotMousePosition.y})`);
  console.log(`  相对偏差 = (${relativeOffsetX}, ${relativeOffsetY})`);
  console.log();
  
  console.log(`  最终坐标 = API鼠标位置 + 相对偏差`);
  console.log(`  最终坐标 = (${config.apiMousePosition.x} + ${relativeOffsetX}, ${config.apiMousePosition.y} + ${relativeOffsetY})`);
  console.log(`  最终坐标 = (${correctedPosition.x}, ${correctedPosition.y})`);
  console.log();

  // 验证结果
  const expectedPosition = { x: 777, y: 486 };
  const isCorrect = correctedPosition.x === expectedPosition.x && correctedPosition.y === expectedPosition.y;
  
  console.log('验证结果:');
  console.log(`  期望坐标: (${expectedPosition.x}, ${expectedPosition.y})`);
  console.log(`  实际坐标: (${correctedPosition.x}, ${correctedPosition.y})`);
  console.log(`  测试结果: ${isCorrect ? '✓ 通过' : '✗ 失败'}`);
  console.log();

  // 测试路径修正
  console.log('=== 测试路径修正 ===\n');
  const screenshotPath = [
    { x: 638, y: 522 },
    { x: 700, y: 550 },
    { x: 750, y: 600 },
  ];
  
  const correctedPath = applyCoordinateCorrectionToPath(screenshotPath, config);
  
  console.log('路径修正结果:');
  screenshotPath.forEach((pos, i) => {
    console.log(`  点${i + 1}: (${pos.x}, ${pos.y}) -> (${correctedPath[i].x}, ${correctedPath[i].y})`);
  });
  console.log();

  return isCorrect;
}

// 运行测试
const testPassed = testCoordinateCorrection();
process.exit(testPassed ? 0 : 1);
