import { Coordinates, BoundingBox } from '../types/computerAction.types';

/**
 * 坐标修正配置
 */
export interface CoordinateCorrectionConfig {
  /** API当前鼠标位置 */
  apiMousePosition: Coordinates;
  /** 截图中鼠标位置 */
  screenshotMousePosition: Coordinates;
  /** 允许的最大偏差阈值（像素），默认5 */
  maxDeviationThreshold?: number;
}

/**
 * 计算边界框的中心点
 * @param bbox 边界框
 * @returns 中心点坐标
 */
export function getBoundingBoxCenter(bbox: BoundingBox): Coordinates {
  return {
    x: Math.round(bbox.x + bbox.width / 2),
    y: Math.round(bbox.y + bbox.height / 2),
  };
}

/**
 * 应用坐标修正到边界框
 *
 * 计算过程：
 * 1. 修正边界框的四个角坐标
 * 2. 根据修正后的角坐标重新计算边界框
 *
 * @param screenshotBoundingBox 截图中的边界框
 * @param config 修正配置
 * @returns 修正后的边界框
 */
export function applyBoundingBoxCorrection(
  screenshotBoundingBox: BoundingBox,
  config: CoordinateCorrectionConfig
): BoundingBox {
  const { apiMousePosition, screenshotMousePosition } = config;

  // 修正左上角
  const correctedTopLeft = applyCoordinateCorrection(
    { x: screenshotBoundingBox.x, y: screenshotBoundingBox.y },
    config
  );

  // 修正右下角
  const bottomRightX = screenshotBoundingBox.x + screenshotBoundingBox.width;
  const bottomRightY = screenshotBoundingBox.y + screenshotBoundingBox.height;
  const correctedBottomRight = applyCoordinateCorrection(
    { x: bottomRightX, y: bottomRightY },
    config
  );

  // 根据修正后的角坐标重新计算边界框
  return {
    x: correctedTopLeft.x,
    y: correctedTopLeft.y,
    width: correctedBottomRight.x - correctedTopLeft.x,
    height: correctedBottomRight.y - correctedTopLeft.y,
  };
}

/**
 * 计算两点之间的距离
 * 
 * @param point1 第一个点
 * @param point2 第二个点
 * @returns 两点之间的欧几里得距离
 */
function calculateDistance(point1: Coordinates, point2: Coordinates): number {
  const dx = point1.x - point2.x;
  const dy = point1.y - point2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 计算坐标偏差
 * 
 * 计算过程示例：
 * - API 当前鼠标位置: (661, 517)
 * - 截图中鼠标位置: (522, 553)
 * - 偏差 = 截图鼠标位置 - API鼠标位置 = (522-661, 553-517) = (-139, 36)
 * 
 * @param config 修正配置
 * @returns 坐标偏差
 */
export function calculateCoordinateOffset(
  config: CoordinateCorrectionConfig
): Coordinates {
  const { apiMousePosition, screenshotMousePosition } = config;
  
  const offsetX = screenshotMousePosition.x - apiMousePosition.x;
  const offsetY = screenshotMousePosition.y - apiMousePosition.y;
  
  return { x: offsetX, y: offsetY };
}

/**
 * 应用坐标修正
 * 
 * 计算过程示例：
 * - 截图中目标位置: (638, 522)
 * - 截图中鼠标位置: (522, 553)
 * - 相对偏差 (目标-鼠标): (638-522, 522-553) = (116, -31)
 * - API当前鼠标位置: (661, 517)
 * - 最终坐标 (API+相对偏差): (661+116, 517+(-31)) = (777, 486)
 * 
 * @param screenshotTargetPosition 截图中的目标位置
 * @param config 修正配置
 * @returns 修正后的坐标
 */
export function applyCoordinateCorrection(
  screenshotTargetPosition: Coordinates,
  config: CoordinateCorrectionConfig
): Coordinates {
  const { apiMousePosition, screenshotMousePosition } = config;
  
  // 计算相对偏差：目标位置相对于鼠标位置的偏差
  const relativeOffsetX = screenshotTargetPosition.x - screenshotMousePosition.x;
  const relativeOffsetY = screenshotTargetPosition.y - screenshotMousePosition.y;
  
  // 应用相对偏差到API鼠标位置
  const correctedX = apiMousePosition.x + relativeOffsetX;
  const correctedY = apiMousePosition.y + relativeOffsetY;
  
  return { x: Math.round(correctedX), y: Math.round(correctedY) };
}

/**
 * 批量修正坐标路径
 * 
 * @param screenshotPath 截图中的路径坐标数组
 * @param config 修正配置
 * @returns 修正后的坐标数组
 */
export function applyCoordinateCorrectionToPath(
  screenshotPath: Coordinates[],
  config: CoordinateCorrectionConfig
): Coordinates[] {
  return screenshotPath.map(position => 
    applyCoordinateCorrection(position, config)
  );
}
