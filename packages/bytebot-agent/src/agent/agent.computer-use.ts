import {
  Button,
  Coordinates,
  BoundingBox,
  Press,
  ComputerToolUseContentBlock,
  ToolResultContentBlock,
  MessageContentType,
  isScreenshotToolUseBlock,
  isCursorPositionToolUseBlock,
  isMoveMouseToolUseBlock,
  isTraceMouseToolUseBlock,
  isClickMouseToolUseBlock,
  isPressMouseToolUseBlock,
  isDragMouseToolUseBlock,
  isScrollToolUseBlock,
  isTypeKeysToolUseBlock,
  isPressKeysToolUseBlock,
  isTypeTextToolUseBlock,
  isWaitToolUseBlock,
  isApplicationToolUseBlock,
  isPasteTextToolUseBlock,
  isReadFileToolUseBlock,
} from '@bytebot/shared';
import { Logger } from '@nestjs/common';

const BYTEBOT_DESKTOP_BASE_URL = process.env.BYTEBOT_DESKTOP_BASE_URL as string;

// 按键状态跟踪 - 用于检测和修复卡住的按键
const pressedKeys = new Set<string>();
const keyPressTimestamps = new Map<string, number>();
const MAX_KEY_PRESS_DURATION = 5000; // 5 秒 - 按键按住的最大时长

// 检查并释放长时间按住的按键
async function checkAndReleaseStuckKeys(): Promise<void> {
  const now = Date.now();
  const stuckKeys: string[] = [];
  
  for (const [key, timestamp] of keyPressTimestamps.entries()) {
    if (now - timestamp > MAX_KEY_PRESS_DURATION) {
      stuckKeys.push(key);
    }
  }
  
  if (stuckKeys.length > 0) {
    console.warn(`Detected stuck keys: ${stuckKeys.join(', ')}, releasing...`);
    
    try {
      await fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'press_keys',
          keys: stuckKeys,
          press: 'up',
        }),
      });
      
      // 清理状态
      for (const key of stuckKeys) {
        pressedKeys.delete(key);
        keyPressTimestamps.delete(key);
      }
      
      console.log(`Released stuck keys: ${stuckKeys.join(', ')}`);
    } catch (error) {
      console.error('Error releasing stuck keys:', error);
    }
  }
}

// 在每次操作前检查卡住的按键
async function safeOperation<T>(operation: () => Promise<T>): Promise<T> {
  await checkAndReleaseStuckKeys();
  return operation();
}


// 计算文本输入的超时时间
function calculateTextTimeout(text: string, delay?: number): number {
  const textLength = text.length;
  
  // 基础超时时间: 30 秒 (增加基础时间以应对网络延迟)
  const baseTimeout = 30000;
  
  // 每个字符的额外时间（考虑输入延迟）
  // 如果有 delay，则每个字符需要 delay 毫秒
  // 否则假设平均每个字符 100ms (增加以应对系统负载)
  const charTime = delay ? delay : 100;
  
  // 计算总时间: 基础时间 + 字符数 * 每字符时间
  const totalTime = baseTimeout + textLength * charTime;
  
  // 最小 60 秒，最大 15 分钟 (增加最大超时时间)
  const minTimeout = 60000;
  const maxTimeout = 900000; // 15 分钟
  
  const timeout = Math.max(minTimeout, Math.min(maxTimeout, totalTime));
  
  console.log(`Calculated timeout for ${textLength} chars: ${timeout}ms (${(timeout/1000).toFixed(1)}s)`);
  
  return timeout;
}

// 通用的 fetch 包装函数，带超时控制和重试机制
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = 60000,
  maxRetries: number = 3
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      
      clearTimeout(timeout);
      
      // 如果响应成功，直接返回
      if (response.ok) {
        return response;
      }
      
      // 如果是服务器错误（5xx），重试
      if (response.status >= 500 && attempt < maxRetries) {
        console.log(`Attempt ${attempt}/${maxRetries} failed with status ${response.status}, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // 指数退避
        continue;
      }
      
      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error as Error;
      
      // 如果是超时错误或网络错误，重试
      if (attempt < maxRetries) {
        console.log(`Attempt ${attempt}/${maxRetries} failed: ${lastError.message}, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // 指数退避
        continue;
      }
    }
  }
  
  // 所有重试都失败了
  throw lastError || new Error('All retry attempts failed');
}


/**
 * 安全解析LLM响应的JSON
 * 处理各种格式错误：单引号、缺失引号、尾随逗号等
 */
function safeParseLLMResponse(text: string | null | undefined): any | null {
  // 检查null或undefined
  if (!text) return null;
  
  // 移除所有 Markdown 代码块标记
  let cleaned = text.replace(/```(json)?\s*/gi, '').replace(/```\s*$/gm, '').trim();
  
  // 尝试解析为数组格式（Qwen 模型可能返回数组）
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const arr = JSON.parse(arrayMatch[0]);
      if (Array.isArray(arr) && arr.length > 0) {
        // 从数组中提取鼠标和目标位置
        const result: any = { mousePosition: null, targetPosition: null, confidence: 'medium' };
        
        for (const item of arr) {
          if (item.label && item.label.toLowerCase().includes('mouse')) {
            // 鼠标位置: {"bbox_2d": [x, y], "label": "Mouse Cursor Position"}
            if (item.bbox_2d && Array.isArray(item.bbox_2d) && item.bbox_2d.length >= 2) {
              result.mousePosition = { x: item.bbox_2d[0], y: item.bbox_2d[1] };
            }
          } else if (item.label && item.label.toLowerCase().includes('target')) {
            // 目标位置: {"bbox_2d": [x, y, width, height], "label": "Target Element"}
            if (item.bbox_2d && Array.isArray(item.bbox_2d)) {
              if (item.bbox_2d.length >= 4) {
                result.targetPosition = {
                  x: item.bbox_2d[0],
                  y: item.bbox_2d[1],
                  width: item.bbox_2d[2],
                  height: item.bbox_2d[3]
                };
              } else if (item.bbox_2d.length >= 2) {
                result.targetPosition = { x: item.bbox_2d[0], y: item.bbox_2d[1] };
              }
            }
          }
        }
        
        // 如果只找到一个元素，假设它是鼠标位置
        if (arr.length === 1 && !result.mousePosition && arr[0].bbox_2d) {
          result.mousePosition = { x: arr[0].bbox_2d[0], y: arr[0].bbox_2d[1] };
        }
        
        if (result.mousePosition) {
          return result;
        }
      }
    } catch (e) {
      // 数组解析失败，继续尝试对象格式
    }
  }
  
  // 提取第一个 { ... } 对象（支持跨行）
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  
  let jsonStr = match[0];
  
  // 检测并修复不完整的 JSON（例如 "x": 后面被截断）
  jsonStr = jsonStr
    // 修复 "x": 后面没有值的情况
    .replace(/"x"\s*:\s*$/gm, '"x": 0')
    // 修复 "y": 后面没有值的情况
    .replace(/"y"\s*:\s*$/gm, '"y": 0')
    // 修复 "width": 后面没有值的情况
    .replace(/"width"\s*:\s*$/gm, '"width": 20')
    // 修复 "height": 后面没有值的情况
    .replace(/"height"\s*:\s*$/gm, '"height": 20')
    // 修复 "confidence": 后面没有值的情况
    .replace(/"confidence"\s*:\s*$/gm, '"confidence": "low"');
  
  try {
    return JSON.parse(jsonStr);
  } catch {
    // 尝试修复常见错误：缺失的引号、单引号、尾随逗号等
    jsonStr = jsonStr
      .replace(/'/g, '"')                           // 单引号转双引号
      .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3') // 属性名加引号
      .replace(/,\s*}/g, '}')                       // 移除尾随逗号
      .replace(/,\s*]/g, ']')                       // 移除数组尾随逗号
      // 修复: {"x":542,609} -> {"x":542,"y":609}
      .replace(/"x"\s*:\s*(\d+)\s*,\s*(\d+)\s*}/g, '"x":$1,"y":$2}');
    
    try {
      return JSON.parse(jsonStr);
    } catch {
      return null;
    }
  }
}

/**
 * 将 LLM 返回的目标位置转换为坐标
 * 支持单点坐标和边界框两种格式
 * @param target LLM 返回的目标位置（可能是单点或边界框）
 * @returns 单点坐标
 */
function normalize(obj: any): Coordinates {
  if (Array.isArray(obj.x) && obj.x.length === 2) return { x: obj.x[0], y: obj.x[1] };
  if (typeof obj.x === 'number' && typeof obj.y === 'number') return { x: obj.x, y: obj.y };
  throw new Error(`Invalid coordinate format: ${JSON.stringify(obj)}`);
}

function normalizeTargetPosition(target: any): Coordinates {
  // 如果是边界框格式，计算中心点
  if (target && typeof target.width === 'number' && typeof target.height === 'number') {
    return {
      x: Math.round(target.x + target.width / 2),
      y: Math.round(target.y + target.height / 2),
    };
  }
  // 否则作为单点坐标处理
  return normalize(target);
}

/**
 * 根据边界框大小动态调整偏差阈值
 * @param boundingBox 边界框
 * @param baseThreshold 基础阈值（默认 20px）
 * @returns 自适应阈值
 */
function calculateAdaptiveThreshold(boundingBox: BoundingBox | null, baseThreshold: number = 20): number {
  if (!boundingBox) {
    return baseThreshold;
  }
  
  // 计算目标的最小边长
  const minDimension = Math.min(boundingBox.width, boundingBox.height);
  
  // 阈值 = 基础阈值 + 目标大小的 10%
  const adaptiveThreshold = baseThreshold + minDimension * 0.1;
  
  // 限制阈值范围：最小 10px，最大 50px
  return Math.max(10, Math.min(50, adaptiveThreshold));
}

/**
 * 检查鼠标是否在边界框附近
 * @param mousePosition 鼠标位置
 * @param boundingBox 边界框
 * @param tolerance 容忍度（像素，默认 5px）
 * @returns 是否在边界框附近
 */
function isMouseNearBoundingBox(
  mousePosition: Coordinates,
  boundingBox: BoundingBox | null,
  tolerance: number = 5  // 使用更小的容忍度（5px）
): boolean {
  if (!boundingBox) {
    return false;
  }
  
  const { x, y, width, height } = boundingBox;
  
  // 检查鼠标是否在边界框的容忍范围内
  const withinX = mousePosition.x >= x - tolerance && mousePosition.x <= x + width + tolerance;
  const withinY = mousePosition.y >= y - tolerance && mousePosition.y <= y + height + tolerance;
  
  return withinX && withinY;
}

// ==================== 新增辅助函数（用于优化移动逻辑） ====================

/**
 * 清洗目标描述，去除冗余方位词
 */
function cleanTargetDescription(desc: string): string {
    return desc
        .replace(/(左下角|右下角|左上角|右上角|的|方块|卡片|按钮|菜单)/g, '')
        .trim();
}

/**
 * 验证坐标是否在合理屏幕范围内
 */
function isValidCoordinate(coord: any, screenWidth = 1920, screenHeight = 1080): boolean {
    return coord && typeof coord.x === 'number' && typeof coord.y === 'number' &&
           coord.x >= 0 && coord.x <= screenWidth &&
           coord.y >= 0 && coord.y <= screenHeight;
}

/**
 * 字段别名映射和标准化
 */
function normalizeFields(obj: any): any {
    const mappings = {
        mouse: ['mousePosition', 'cursor', 'mouse'],
        target: ['targetPosition', 'bbox', 'element', 'target'],
        width: ['width', 'w'],
        height: ['height', 'h'],
        confidence: ['confidence']
    };
    const result: any = {};
    // 处理鼠标位置
    for (const key of mappings.mouse) {
        if (obj[key]) {
            if (obj[key].x !== undefined && obj[key].y !== undefined) {
                result.mousePosition = { x: obj[key].x, y: obj[key].y };
            } else if (Array.isArray(obj[key]) && obj[key].length === 2) {
                result.mousePosition = { x: obj[key][0], y: obj[key][1] };
            }
            break;
        }
    }
    // 处理目标位置
    for (const key of mappings.target) {
        if (obj[key]) {
            if (obj[key].x !== undefined && obj[key].y !== undefined) {
                let width = obj[key].width, height = obj[key].height;
                if (width === undefined) {
                    for (const wk of mappings.width) {
                        if (obj[key][wk] !== undefined) { width = obj[key][wk]; break; }
                    }
                }
                if (height === undefined) {
                    for (const hk of mappings.height) {
                        if (obj[key][hk] !== undefined) { height = obj[key][hk]; break; }
                    }
                }
                result.targetPosition = { x: obj[key].x, y: obj[key].y, width, height };
            } else if (Array.isArray(obj[key])) {
                if (obj[key].length >= 4) {
                    result.targetPosition = { x: obj[key][0], y: obj[key][1], width: obj[key][2], height: obj[key][3] };
                } else if (obj[key].length >= 2) {
                    result.targetPosition = { x: obj[key][0], y: obj[key][1] };
                }
            }
            break;
        }
    }
    // 处理置信度
    for (const key of mappings.confidence) {
        if (obj[key]) {
            result.confidence = obj[key];
            break;
        }
    }
    result.confidence = result.confidence || 'medium';
    return result;
}

/**
 * 增强版 JSON 解析：支持常见格式和字段别名
 */
function parseLLMResponse(text: string | null | undefined): any | null {
    if (!text) return null;
    let cleaned = text.replace(/```(json)?\s*/gi, '').replace(/```\s*$/gm, '').trim();

    // 尝试直接解析整个响应
    try {
        const parsed = JSON.parse(cleaned);
        return normalizeFields(parsed);
    } catch {}

    // 尝试解析数组格式（兼容所有已知变体）
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
        try {
            const arr = JSON.parse(arrayMatch[0]);
            if (Array.isArray(arr)) {
                // 情况1：纯坐标数组 [x, y] 或 [x, y, w, h]
                if (arr.length === 2) {
                    return { mousePosition: { x: arr[0], y: arr[1] } };
                }
                if (arr.length === 4) {
                    return { targetPosition: { x: arr[0], y: arr[1], width: arr[2], height: arr[3] } };
                }

                // 情况2：对象数组 - 合并所有信息
                const result: any = {};
                for (const item of arr) {
                    // 提取鼠标位置（优先）
                    if (item.mouse) {
                        if (item.mouse.x !== undefined && item.mouse.y !== undefined) {
                            result.mousePosition = { x: item.mouse.x, y: item.mouse.y };
                        } else if (Array.isArray(item.mouse) && item.mouse.length >= 2) {
                            result.mousePosition = { x: item.mouse[0], y: item.mouse[1] };
                        }
                    }

                    // 提取目标位置（优先）
                    if (item.target) {
                        if (item.target.x !== undefined && item.target.y !== undefined) {
                            const width = item.target.w ?? item.target.width;
                            const height = item.target.h ?? item.target.height;
                            result.targetPosition = {
                                x: item.target.x,
                                y: item.target.y,
                                width: width,
                                height: height
                            };
                        } else if (Array.isArray(item.target) && item.target.length >= 2) {
                            result.targetPosition = { x: item.target[0], y: item.target[1] };
                        }
                    }

                    // 处理 bbox_2d（后备）
                    if (item.bbox_2d && Array.isArray(item.bbox_2d)) {
                        const label = (item.label || '').toLowerCase();
                        if (label.includes('mouse') || label.includes('cursor')) {
                            // 鼠标位置：取前两个值
                            result.mousePosition = { x: item.bbox_2d[0], y: item.bbox_2d[1] };
                        } else {
                            // 视为目标框
                            if (item.bbox_2d.length >= 4) {
                                const [x1, y1, x2, y2] = item.bbox_2d;
                                result.targetPosition = {
                                    x: x1,
                                    y: y1,
                                    width: Math.max(0, x2 - x1),
                                    height: Math.max(0, y2 - y1)
                                };
                            } else if (item.bbox_2d.length >= 2) {
                                // 单点目标
                                result.targetPosition = { x: item.bbox_2d[0], y: item.bbox_2d[1] };
                            }
                        }
                    }

                    // 提取置信度
                    if (item.confidence) {
                        result.confidence = item.confidence;
                    }
                }

                // 如果已经提取到鼠标或目标，返回结果
                if (result.mousePosition || result.targetPosition) {
                    return result;
                }

                // 降级：数组只有一项且包含 bbox_2d，直接作为目标框
                if (arr.length === 1 && arr[0].bbox_2d && Array.isArray(arr[0].bbox_2d)) {
                    const bbox = arr[0].bbox_2d;
                    if (bbox.length >= 4) {
                        const [x1, y1, x2, y2] = bbox;
                        return {
                            targetPosition: {
                                x: x1,
                                y: y1,
                                width: Math.max(0, x2 - x1),
                                height: Math.max(0, y2 - y1)
                            }
                        };
                    } else if (bbox.length >= 2) {
                        return { targetPosition: { x: bbox[0], y: bbox[1] } };
                    }
                }
            }
        } catch {}
    }

    // 修复常见错误并重试
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;

    let jsonStr = match[0]
        .replace(/"x"\s*:\s*$/gm, '"x": 0')
        .replace(/"y"\s*:\s*$/gm, '"y": 0')
        .replace(/"width"\s*:\s*$/gm, '"width": 20')
        .replace(/"height"\s*:\s*$/gm, '"height": 20')
        .replace(/"confidence"\s*:\s*$/gm, '"confidence": "low"')
        .replace(/'/g, '"')
        .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3')
        .replace(/,\s*}/g, '}')
        .replace(/,\s*]/g, ']')
        .replace(/"x"\s*:\s*(\d+)\s*,\s*(\d+)\s*}/g, '"x":$1,"y":$2}');

    try {
        const parsed = JSON.parse(jsonStr);
        return normalizeFields(parsed);
    } catch {
        return null;
    }
}

/**
 * 试探性移动一小步
 */
function getTentativeTarget(current: Coordinates, initial: Coordinates, step: number = 20): Coordinates {
    const dx = initial.x - current.x;
    const dy = initial.y - current.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < step) return initial;
    const ratio = step / distance;
    return {
        x: Math.round(current.x + dx * ratio),
        y: Math.round(current.y + dy * ratio)
    };
}

// ==================== 优化后的迭代移动函数 ====================

async function moveMouseWithIterationApproach(
  targetCoordinates: Coordinates,
  targetDescription: string,
  logger: Logger,
  maxIterations: number = 3,
  deviationThreshold: number = 20,
): Promise<{ success: boolean; iterations: number; finalDeviation: number; finalPosition: Coordinates }> {
  // 如果 coordinates 是字符串，先解析为对象
  if (typeof targetCoordinates === 'string') {
    const coordStr = targetCoordinates as string;
    try {
      // 先尝试修复常见格式错误: {"x": 536, 448} -> {"x": 536, "y": 448}
      let fixedStr = coordStr.replace(/"x"\s*:\s*(\d+)\s*,\s*(\d+)/g, '"x": $1, "y": $2');
      targetCoordinates = JSON.parse(fixedStr);
      logger.debug('Parsed string coordinates:', targetCoordinates);
      if (Array.isArray(targetCoordinates) && targetCoordinates.length >= 2) {
        targetCoordinates = { x: targetCoordinates[0], y: targetCoordinates[1] };
        logger.debug('Converted array coordinates to object:', targetCoordinates);
      }
    } catch (e) {
      logger.error('Failed to parse coordinates string:', coordStr);
      // 尝试使用正则直接提取数字
      const match = coordStr.match(/"x"\s*:\s*(\d+)\s*,\s*(\d+)/);
      if (match) {
        targetCoordinates = { x: parseInt(match[1]), y: parseInt(match[2]) };
        logger.debug('Extracted coordinates using regex:', targetCoordinates);
      }
    }
  }

  // 修复常见格式错误: {"x": 704, 563} -> {"x": 704, "y": 563}
  if (targetCoordinates && typeof targetCoordinates.x === 'number' && typeof targetCoordinates.y === 'undefined') {
    const str = JSON.stringify(targetCoordinates);
    // 更宽松的正则，匹配各种格式
    const match = str.match(/"x"\s*:\s*(\d+)[,\s]+(\d+)/);
    if (match) {
      targetCoordinates = { x: parseInt(match[1]), y: parseInt(match[2]) };
      logger.debug('Fixed coordinates format:', targetCoordinates);
    }
  }

  // 验证参数
  if (!targetCoordinates || typeof targetCoordinates.x !== 'number' || typeof targetCoordinates.y !== 'number') {
    logger.error('Invalid target coordinates:', targetCoordinates);
    return {
      success: false,
      iterations: 0,
      finalDeviation: Infinity,
      finalPosition: targetCoordinates || { x: 0, y: 0 },
    };
  }

  // 清洗目标描述
  const cleanDesc = cleanTargetDescription(targetDescription);
  logger.debug(`Starting iterative mouse movement to (${targetCoordinates.x}, ${targetCoordinates.y})`);
  logger.debug(`Original target description: "${targetDescription}" -> cleaned: "${cleanDesc}"`);

  const initialTarget = { ...targetCoordinates };

  let iteration = 0;
  let currentDeviation = Infinity;
  let lastActualPosition: Coordinates | null = null;      // 物理鼠标位置
  let lastAiMouse: Coordinates | null = null;             // AI识别的鼠标位置（用于判断）
  let boundingBox: BoundingBox | null = null;
  let targetCenter: Coordinates | null = null;
  let success = false;
  let lastValidParsed: any | null = null;                 // 上一次成功解析的数据
  let lastValidBoundingBox: BoundingBox | null = null;    // 上一次成功的边界框
  let lastValidTimestamp = 0;                              // 历史数据时间戳

  const LITELLM_BASE_URL = process.env.LITELLM_BASE_URL || 'http://bytebot-bytebot-llm-proxy-1:4000';
  const LITELLM_MODEL = process.env.LITELLM_MODEL || 'qwen3.5:35b';
  const SCREEN_WIDTH = 1280;
  const SCREEN_HEIGHT = 960;
  const HISTORY_EXPIRY_MS = 30000; // 历史数据有效期 30 秒
  const MAX_HISTORY_DISTANCE = 200; // 历史框中心与当前鼠标的最大合理距离

  logger.debug(`Using LiteLLM at ${LITELLM_BASE_URL} with model ${LITELLM_MODEL} for screenshot analysis`);

  while (iteration < maxIterations && !success) {
    iteration++;
    logger.debug(`Iteration ${iteration}: Starting`);

    try {
      // 1. 移动鼠标到当前目标坐标
      logger.debug(`Iteration ${iteration}: Moving mouse to (${targetCoordinates.x}, ${targetCoordinates.y})`);
      await fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'move_mouse',
          coordinates: targetCoordinates,
        }),
      });

      // 2. 并发获取物理鼠标位置和截图
      const [apiPos, screenshotData] = await Promise.all([
        fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'cursor_position' })
        }).then(res => res.json()),
        fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'screenshot', includeCursor: true })
        }).then(res => res.json())
      ]);

      lastActualPosition = apiPos;
      const screenshotBase64 = screenshotData.image;
      logger.debug(`Iteration ${iteration}: API mouse at (${apiPos.x}, ${apiPos.y})`);

      // 3. 调用 LiteLLM 分析
      const llmRes = await fetch(`${LITELLM_BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: LITELLM_MODEL,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshotBase64}` } },
                {
                  type: 'text',
                  text: `Locate "${targetDescription}" in the screenshot.
Return ONLY a JSON object with:
- mouse: {"x": pixel_x, "y": pixel_y} (coordinates of the mouse cursor tip, normally is a white arrow with black border, if visible; otherwise omit)
- target: {"x": left_x, "y": top_y, "w": width_px, "h": height_px} (tight bounding box of the element)
- confidence: "high" | "medium" | "low" (your confidence level)

Example: {"mouse":{"x":100,"y":200},"target":{"x":300,"y":400,"w":50,"h":30},"confidence":"high"}

Constraints: coordinates must be integers between 0 and 1920 (x) and 0 and 1080 (y). If element not clearly visible, set confidence to "low".`
                }
              ]
            }
          ],
          max_tokens: 2000,
          temperature: 0.1
        })
      });

      if (!llmRes.ok) {
        throw new Error(`LiteLLM request failed: ${llmRes.status} ${await llmRes.text()}`);
      }

      const llmResult = await llmRes.json();
      const message = llmResult.choices[0].message;
      const responseText = message.content;
      
      // 检查是否有 tool_calls（某些模型可能通过 tool_calls 返回结果）
      let parsed: any = null;
      if (message.tool_calls && message.tool_calls.length > 0) {
        logger.debug(`Iteration ${iteration}: LiteLLM returned tool_calls instead of content`);
        for (const toolCall of message.tool_calls) {
          if (toolCall.function && toolCall.function.arguments) {
            try {
              const args = JSON.parse(toolCall.function.arguments);
              if (args.mousePosition || args.targetPosition || args.mouse || args.target) {
                parsed = args;
                logger.debug(`Iteration ${iteration}: Parsed from tool_calls: ${JSON.stringify(parsed)}`);
                break;
              }
            } catch (e) {
              logger.warn(`Iteration ${iteration}: Failed to parse tool_call arguments: ${toolCall.function.arguments}`);
            }
          }
        }
      }
      
      // 如果没有从 tool_calls 解析到，尝试从 content 解析
      if (!parsed && message.content) {
        logger.debug(`Iteration ${iteration}: LiteLLM response: ${responseText}`);
        parsed = parseLLMResponse(message.content);
      }

      // 结构化日志
      logger.debug({
        msg: 'AI response parsed',
        iteration,
        parsed: parsed ? {
          mouse: parsed.mousePosition,
          targetBox: parsed.targetPosition,
          confidence: parsed.confidence
        } : null,
        rawResponse: message.content?.substring(0, 200)
      });
      
      // 处理解析失败的情况
      if (!parsed) {
        logger.error(`Iteration ${iteration}: Failed to parse AI response (content: ${message.content?.substring(0, 200)}, tool_calls: ${JSON.stringify(message.tool_calls)})`);
        
        const now = Date.now();
        // 检查历史数据是否可用
        const historyValid = lastValidParsed && lastValidBoundingBox &&
                             (now - lastValidTimestamp < HISTORY_EXPIRY_MS);
        if (historyValid) {
          // 合理性检查：历史框中心与当前物理鼠标距离
          const histCenter = {
            x: lastValidBoundingBox!.x + lastValidBoundingBox!.width / 2,
            y: lastValidBoundingBox!.y + lastValidBoundingBox!.height / 2
          };
          const distToHistory = Math.hypot(apiPos.x - histCenter.x, apiPos.y - histCenter.y);
          if (distToHistory < MAX_HISTORY_DISTANCE) {
            logger.warn(`Iteration ${iteration}: Using last valid parsed data as fallback (within expiry and reasonable distance)`);
            boundingBox = lastValidBoundingBox;
            lastAiMouse = apiPos;
            // 现在确保非空（通过非空断言，因为已赋值）
            const bb = boundingBox!;
            const lm = lastAiMouse!;
            targetCenter = {
              x: bb.x + bb.width / 2,
              y: bb.y + bb.height / 2,
            };
            
            // 检查是否已在目标内
            const INNER_MARGIN = Math.max(1, Math.min(5, Math.floor(bb.width * 0.05)));
            const effectiveX = bb.x + INNER_MARGIN;
            const effectiveY = bb.y + INNER_MARGIN;
            const effectiveWidth = bb.width - 2 * INNER_MARGIN;
            const effectiveHeight = bb.height - 2 * INNER_MARGIN;
            
            let insideEffective = false;
            if (effectiveWidth > 0 && effectiveHeight > 0) {
              insideEffective = lm.x >= effectiveX && lm.x <= effectiveX + effectiveWidth &&
                                lm.y >= effectiveY && lm.y <= effectiveY + effectiveHeight;
            } else {
              insideEffective = lm.x >= bb.x && lm.x <= bb.x + bb.width &&
                                lm.y >= bb.y && lm.y <= bb.y + bb.height;
            }
            
            if (insideEffective) {
              logger.debug(`Iteration ${iteration}: AI mouse is inside effective inner area (using fallback data), stopping`);
              success = true;
              break;
            }
            
            // 继续向目标移动
            const dx = targetCenter.x - lm.x;
            const dy = targetCenter.y - lm.y;
            currentDeviation = Math.sqrt(dx * dx + dy * dy);
            targetCoordinates = {
              x: Math.round(apiPos.x + dx),
              y: Math.round(apiPos.y + dy),
            };
            logger.debug(`Iteration ${iteration}: Moving towards center (${targetCenter.x}, ${targetCenter.y}) using fallback data, deviation=${currentDeviation.toFixed(2)}`);
            continue;
          } else {
            logger.warn('History data too far from current mouse, ignoring');
          }
        }
        
        if (iteration === 1) {
          // 第一次迭代失败，使用初始目标坐标创建虚拟边界框
          logger.warn(`Iteration ${iteration}: First iteration failed, using initial target coordinates as fallback`);
          const VIRTUAL_BOX_SIZE = 20; // 虚拟边界框大小
          boundingBox = {
            x: initialTarget.x - VIRTUAL_BOX_SIZE / 2,
            y: initialTarget.y - VIRTUAL_BOX_SIZE / 2,
            width: VIRTUAL_BOX_SIZE,
            height: VIRTUAL_BOX_SIZE,
          };
          lastAiMouse = apiPos;
          lastValidBoundingBox = { ...boundingBox };
          lastValidTimestamp = now;
          
          // 计算到目标的距离
          const dx = initialTarget.x - apiPos.x;
          const dy = initialTarget.y - apiPos.y;
          currentDeviation = Math.sqrt(dx * dx + dy * dy);
          
          // 如果已经在目标附近，认为成功
          if (currentDeviation <= deviationThreshold) {
            logger.debug(`Iteration ${iteration}: Already at initial target, stopping`);
            success = true;
            break;
          }
          
          // 继续向初始目标移动
          targetCoordinates = {
            x: Math.round(apiPos.x + dx),
            y: Math.round(apiPos.y + dy),
          };
          logger.debug(`Iteration ${iteration}: Moving towards initial target (${initialTarget.x}, ${initialTarget.y}), deviation=${currentDeviation.toFixed(2)}`);
          continue;
        } else {
          // 没有历史数据，使用试探性移动
          targetCoordinates = getTentativeTarget(apiPos, initialTarget);
          continue;
        }
      }

      // 解析 AI 鼠标位置
      let aiMouse = parsed.mousePosition ? 
        (parsed.mousePosition.x !== undefined ? parsed.mousePosition : { x: parsed.mousePosition[0], y: parsed.mousePosition[1] }) : null;
      boundingBox = parsed.targetPosition?.width ? parsed.targetPosition as BoundingBox : null;
      const confidence = parsed.confidence || 'medium';
      
      // 坐标验证
      if (aiMouse && !isValidCoordinate(aiMouse, SCREEN_WIDTH, SCREEN_HEIGHT)) {
        logger.warn(`Iteration ${iteration}: AI mouse position out of range (${aiMouse.x},${aiMouse.y}), using API position instead`);
        aiMouse = apiPos;
      }
      
      // 保存成功解析的数据，用于后续迭代的降级处理
      if (parsed && (aiMouse || boundingBox)) {
        lastValidParsed = parsed;
        if (boundingBox) {
          lastValidBoundingBox = { ...boundingBox };
          lastValidTimestamp = Date.now();
        }
      }

      if (!aiMouse) {
        logger.warn(`Iteration ${iteration}: AI did not provide mouse position, using API position for fallback`);
        // 降级：使用物理鼠标位置作为 AI 鼠标（实际上不可靠，但至少能继续）
        lastAiMouse = apiPos;
      } else {
        lastAiMouse = aiMouse;
      }

      if (boundingBox && lastAiMouse) {
        // 有边界框：计算中心点作为移动目标
        targetCenter = {
          x: boundingBox.x + boundingBox.width / 2,
          y: boundingBox.y + boundingBox.height / 2,
        };

        // 动态内缩边距
        const INNER_MARGIN = Math.max(1, Math.min(5, Math.floor(boundingBox.width * 0.05)));
        const effectiveX = boundingBox.x + INNER_MARGIN;
        const effectiveY = boundingBox.y + INNER_MARGIN;
        const effectiveWidth = boundingBox.width - 2 * INNER_MARGIN;
        const effectiveHeight = boundingBox.height - 2 * INNER_MARGIN;

        // 检查 AI 识别的鼠标是否在有效区域内
        let insideEffective = false;
        if (effectiveWidth > 0 && effectiveHeight > 0) {
          insideEffective = lastAiMouse.x >= effectiveX && lastAiMouse.x <= effectiveX + effectiveWidth &&
                            lastAiMouse.y >= effectiveY && lastAiMouse.y <= effectiveY + effectiveHeight;
        } else {
          // 如果内缩后区域无效，回退到原始边界框
          insideEffective = lastAiMouse.x >= boundingBox.x && lastAiMouse.x <= boundingBox.x + boundingBox.width &&
                            lastAiMouse.y >= boundingBox.y && lastAiMouse.y <= boundingBox.y + boundingBox.height;
        }

        if (insideEffective) {
          logger.debug(`Iteration ${iteration}: AI mouse is inside effective inner area, stopping`);
          success = true;
          break;
        }

        // 计算偏移量：目标中心 - AI鼠标位置
        const dx = targetCenter.x - lastAiMouse.x;
        const dy = targetCenter.y - lastAiMouse.y;
        currentDeviation = Math.sqrt(dx * dx + dy * dy);

        // 向中心点移动，步长根据置信度调整
        const stepFactor = confidence === 'low' ? 0.5 : 1.0;
        targetCoordinates = {
          x: Math.round(apiPos.x + dx * stepFactor),
          y: Math.round(apiPos.y + dy * stepFactor),
        };

        logger.debug(`Iteration ${iteration}: Moving towards center (${targetCenter.x}, ${targetCenter.y}), AI deviation=${currentDeviation.toFixed(2)}`);
      } else if (parsed.targetPosition && lastAiMouse) {
        // 无边界框但有目标点坐标
        const targetPoint = parsed.targetPosition.width ?
          { x: parsed.targetPosition.x + parsed.targetPosition.width / 2, y: parsed.targetPosition.y + parsed.targetPosition.height / 2 } :
          (parsed.targetPosition.x !== undefined ? parsed.targetPosition : { x: parsed.targetPosition[0], y: parsed.targetPosition[1] });

        const dx = targetPoint.x - lastAiMouse.x;
        const dy = targetPoint.y - lastAiMouse.y;
        currentDeviation = Math.sqrt(dx * dx + dy * dy);

        if (currentDeviation <= deviationThreshold) {
          logger.debug(`Iteration ${iteration}: Deviation within threshold, stopping`);
          success = true;
          break;
        }

        const stepFactor = confidence === 'low' ? 0.5 : 1.0;
        targetCoordinates = {
          x: Math.round(apiPos.x + dx * stepFactor),
          y: Math.round(apiPos.y + dy * stepFactor),
        };

        logger.debug(`Iteration ${iteration}: Target point (${targetPoint.x}, ${targetPoint.y}), AI deviation=${currentDeviation.toFixed(2)}`);
      } else {
        logger.debug(`Iteration ${iteration}: No target information from AI, using tentative move`);
        targetCoordinates = getTentativeTarget(apiPos, initialTarget);
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      logger.error(`Iteration ${iteration} failed: ${error.message}`);
      targetCoordinates = getTentativeTarget(lastActualPosition || targetCoordinates, initialTarget);
    }
  }

  // 最终成功判断（如果循环因 success=true 退出，已经正确；否则根据条件再次确认）
  if (!success) {
    if (boundingBox && lastAiMouse) {
      const INNER_MARGIN = Math.max(1, Math.min(5, Math.floor(boundingBox.width * 0.05)));
      const effectiveX = boundingBox.x + INNER_MARGIN;
      const effectiveY = boundingBox.y + INNER_MARGIN;
      const effectiveWidth = boundingBox.width - 2 * INNER_MARGIN;
      const effectiveHeight = boundingBox.height - 2 * INNER_MARGIN;
      let finalInside = false;
      if (effectiveWidth > 0 && effectiveHeight > 0) {
        finalInside = lastAiMouse.x >= effectiveX && lastAiMouse.x <= effectiveX + effectiveWidth &&
                      lastAiMouse.y >= effectiveY && lastAiMouse.y <= effectiveY + effectiveHeight;
      } else {
        finalInside = lastAiMouse.x >= boundingBox.x && lastAiMouse.x <= boundingBox.x + boundingBox.width &&
                      lastAiMouse.y >= boundingBox.y && lastAiMouse.y <= boundingBox.y + boundingBox.height;
      }
      success = finalInside;
    } else {
      success = currentDeviation <= deviationThreshold;
    }
  }

  logger.debug(
    `Iterative movement completed: ${success ? 'SUCCESS' : 'FAILED'}, ` +
      `iterations=${iteration}, final deviation=${currentDeviation.toFixed(2)}px`,
  );

  return {
    success,
    iterations: iteration,
    finalDeviation: currentDeviation,
    finalPosition: lastActualPosition || targetCoordinates,
  };
}

export async function handleComputerToolUse(
  block: ComputerToolUseContentBlock,
  logger: Logger,
): Promise<ToolResultContentBlock> {
  logger.debug(`Handling computer tool use: ${block.name}, tool_use_id: ${block.id}`);

  if (isScreenshotToolUseBlock(block)) {
    logger.debug('Processing screenshot request');
    try {
      logger.debug('Taking screenshot');
      const image = await screenshot();
      logger.debug('Screenshot captured successfully');

      return {
        type: MessageContentType.ToolResult,
        tool_use_id: block.id,
        content: [
          {
            type: MessageContentType.Image,
            source: {
              data: image,
              media_type: 'image/png',
              type: 'base64',
            },
          },
        ],
      };
    } catch (error) {
      logger.error(`Screenshot failed: ${error.message}`, error.stack);
      return {
        type: MessageContentType.ToolResult,
        tool_use_id: block.id,
        content: [
          {
            type: MessageContentType.Text,
            text: 'ERROR: Failed to take screenshot',
          },
        ],
        is_error: true,
      };
    }
  }

  if (isCursorPositionToolUseBlock(block)) {
    logger.debug('Processing cursor position request');
    try {
      logger.debug('Getting cursor position');
      const position = await cursorPosition();
      logger.debug(`Cursor position obtained: ${position.x}, ${position.y}`);

      return {
        type: MessageContentType.ToolResult,
        tool_use_id: block.id,
        content: [
          {
            type: MessageContentType.Text,
            text: `Cursor position: ${position.x}, ${position.y}`,
          },
        ],
      };
    } catch (error) {
      logger.error(`Getting cursor position failed: ${error.message}`, error.stack);
      return {
        type: MessageContentType.ToolResult,
        tool_use_id: block.id,
        content: [
          {
            type: MessageContentType.Text,
            text: 'ERROR: Failed to get cursor position',
          },
        ],
        is_error: true,
      };
    }
  }

  // Handle all mouse actions
  try {
    if (isMoveMouseToolUseBlock(block)) {
      // 使用迭代逼近移动
      const result = await moveMouseWithIterationApproach(block.input.coordinates, block.input.targetDescription, logger);

      return {
        type: MessageContentType.ToolResult,
        tool_use_id: block.id,
        content: [
          {
            type: MessageContentType.Text,
            text: result.success
              ? `Mouse moved successfully to target position after ${result.iterations} iterations (deviation: ${result.finalDeviation.toFixed(2)}px)`
              : `Mouse movement completed with deviation ${result.finalDeviation.toFixed(2)}px after ${result.iterations} iterations`,
          },
        ],
      };
    }
    if (isTraceMouseToolUseBlock(block)) {
      await traceMouse(block.input);
    }
    if (isClickMouseToolUseBlock(block)) {
        // 点击前先使用迭代逼近移动到目标位置
        // 如果没有提供坐标，使用当前鼠标位置作为初始参考点
        let targetCoords: Coordinates = block.input.coordinates!;
        if (!block.input.coordinates) {
          // 获取当前鼠标位置
          const cursorPosResponse = await fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'cursor_position' }),
          });
          const cursorPosResult = await cursorPosResponse.json();
          targetCoords = cursorPosResult.coordinates;
          logger.debug(`No coordinates provided, using current cursor position: (${targetCoords.x}, ${targetCoords.y})`);
        }

        const moveResult = await moveMouseWithIterationApproach(targetCoords, block.input.targetDescription, logger);
        // 只有移动成功才执行点击
        if (!moveResult.success) {
          return {
            type: MessageContentType.ToolResult,
            tool_use_id: block.id,
            content: [
              {
                type: MessageContentType.Text,
                text: `ERROR: Mouse movement failed. Deviation ${moveResult.finalDeviation.toFixed(2)}px exceeds threshold. Click not executed.`,
              },
            ],
            is_error: true,
          };
        }
        // 不传入坐标，避免Desktop端再次移动
        await clickMouse({
          button: block.input.button || 'left',
          clickCount: block.input.clickCount || 1,
          holdKeys: block.input.holdKeys,
        }, logger);
      }
    if (isPressMouseToolUseBlock(block)) {
        // 按压前先移动到目标位置
        let targetCoords: Coordinates = block.input.coordinates!;
        if (!block.input.coordinates) {
          const cursorPosResponse = await fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'cursor_position' }),
          });
          const cursorPosResult = await cursorPosResponse.json();
          targetCoords = cursorPosResult.coordinates;
          logger.debug(`No coordinates provided, using current cursor position: (${targetCoords.x}, ${targetCoords.y})`);
        }

        const moveResult = await moveMouseWithIterationApproach(targetCoords, block.input.targetDescription, logger);
        if (!moveResult.success) {
          return {
            type: MessageContentType.ToolResult,
            tool_use_id: block.id,
            content: [
              {
                type: MessageContentType.Text,
                text: `ERROR: Mouse movement failed. Deviation ${moveResult.finalDeviation.toFixed(2)}px exceeds threshold. Press not executed.`,
              },
            ],
            is_error: true,
          };
        }
        await pressMouse({
          button: block.input.button,
          press: block.input.press,
        });
      }
    if (isDragMouseToolUseBlock(block)) {
        // 拖拽前先移动到起始位置
        if (block.input.path && block.input.path.length > 0) {
          const moveResult = await moveMouseWithIterationApproach(block.input.path[0], block.input.targetDescription, logger);
          if (!moveResult.success) {
            return {
              type: MessageContentType.ToolResult,
              tool_use_id: block.id,
              content: [
                {
                  type: MessageContentType.Text,
                  text: `ERROR: Mouse movement failed. Deviation ${moveResult.finalDeviation.toFixed(2)}px exceeds threshold. Drag not executed.`,
                },
              ],
              is_error: true,
            };
          }
          // 不传入第一个坐标，避免Desktop端再次移动
          const pathWithoutFirst = block.input.path.slice(1);
          await dragMouse({
            path: pathWithoutFirst,
            button: block.input.button,
            holdKeys: block.input.holdKeys,
          });
        } else {
          await dragMouse(block.input);
        }
      }
      if (isScrollToolUseBlock(block)) {
          // 滚动操作：如果提供了坐标，直接移动到该位置（不迭代）
          // 滚动操作不需要精确的偏差验证，因为目标是滚动内容而非精确定位
          if (block.input.coordinates) {
            // 直接移动到指定位置，不使用迭代逼近
            logger.debug(`Moving mouse to scroll position: (${block.input.coordinates.x}, ${block.input.coordinates.y})`);
            await fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'move_mouse',
                coordinates: block.input.coordinates,
              }),
            });
          }
          // 如果没有提供坐标，在当前位置滚动
          
          await scroll({
            coordinates: block.input.coordinates,
            direction: block.input.direction,
            scrollCount: block.input.scrollCount,
            holdKeys: block.input.holdKeys,
          });
        }
    if (isTypeKeysToolUseBlock(block)) {
      await typeKeys(block.input);
    }
    if (isPressKeysToolUseBlock(block)) {
      await pressKeys(block.input);
    }
    if (isTypeTextToolUseBlock(block)) {
      await typeText(block.input);
    }
    if (isPasteTextToolUseBlock(block)) {
      await pasteText(block.input);
    }
    if (isWaitToolUseBlock(block)) {
      await wait(block.input);
    }
    if (isApplicationToolUseBlock(block)) {
      await application(block.input);
    }
    if (isReadFileToolUseBlock(block)) {
      logger.debug(`Reading file: ${block.input.path}`);
      const result = await readFile(block.input);

      if (result.success && result.data) {
        return {
          type: MessageContentType.ToolResult,
          tool_use_id: block.id,
          content: [
            {
              type: MessageContentType.Document,
              source: {
                type: 'base64',
                media_type: 'text/plain',
                data: result.data,
              },
            },
          ],
        };
      } else {
        return {
          type: MessageContentType.ToolResult,
          tool_use_id: block.id,
          content: [
            {
              type: MessageContentType.Text,
              text: `ERROR: Failed to read file: ${result.error}`,
            },
          ],
          is_error: true,
        };
      }
    }

    return {
      type: MessageContentType.ToolResult,
      tool_use_id: block.id,
      content: [
        {
          type: MessageContentType.Text,
          text: 'SUCCESS',
        },
      ],
    };
  } catch (error) {
    logger.error(`Computer action failed: ${error.message}`, error.stack);
    return {
      type: MessageContentType.ToolResult,
      tool_use_id: block.id,
      content: [
        {
          type: MessageContentType.Text,
          text: `ERROR: ${error.message}`,
        },
      ],
      is_error: true,
    };
  }
}

async function screenshot(params?: { includeCursor?: boolean }): Promise<string> {
  const response = await fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'screenshot',
      ...params,
    }),
  });
  const data = await response.json();
  return data.image;
}

async function cursorPosition(): Promise<Coordinates> {
  const response = await fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'cursor_position',
    }),
  });
  return await response.json();
}

async function traceMouse(input: { path: Coordinates[]; holdKeys?: string[] }): Promise<void> {
  const { path, holdKeys } = input;
  console.log(`Tracing mouse to path: ${path} ${holdKeys ? `with holdKeys: ${holdKeys}` : ''}`);

  try {
    await fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'trace_mouse',
        path,
        holdKeys,
      }),
    });
  } catch (error) {
    console.error('Error in trace_mouse action:', error);
    throw error;
  }
}

async function clickMouse(input: {
  coordinates?: Coordinates;
  button: Button;
  clickCount: number;
  holdKeys?: string[];
}, logger?: Logger): Promise<void> {
  const { coordinates, button, clickCount, holdKeys } = input;
  console.log(
    `Clicking mouse: ${button} ${clickCount} times ${coordinates ? `at [${coordinates.x}, ${coordinates.y}]` : 'at current position'} ${holdKeys ? `with holdKeys: ${holdKeys}` : ''}`,
  );

  try {
    await fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'click_mouse',
        coordinates,
        button,
        clickCount,
        holdKeys,
      }),
    });
  } catch (error) {
    console.error('Error in click_mouse action:', error);
    throw error;
  }
}

async function pressMouse(input: { coordinates?: Coordinates; button: Button; press: Press }): Promise<void> {
  const { coordinates, button, press } = input;
  console.log(
    `Pressing mouse: ${button} ${press} ${coordinates ? `at [${coordinates.x}, ${coordinates.y}]` : 'at current position'}`,
  );

  try {
    await fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'press_mouse',
        coordinates,
        button,
        press,
      }),
    });
  } catch (error) {
    console.error('Error in press_mouse action:', error);
    throw error;
  }
}

async function dragMouse(input: { path: Coordinates[]; button: Button; holdKeys?: string[] }): Promise<void> {
  const { path, button, holdKeys } = input;
  console.log(`Dragging mouse: ${button} along path: ${path} ${holdKeys ? `with holdKeys: ${holdKeys}` : ''}`);

  try {
    await fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'drag_mouse',
        path,
        button,
        holdKeys,
      }),
    });
  } catch (error) {
    console.error('Error in drag_mouse action:', error);
    throw error;
  }
}

async function scroll(input: {
  coordinates?: Coordinates;
  direction: 'up' | 'down' | 'left' | 'right';
  scrollCount: number;
  holdKeys?: string[];
}): Promise<void> {
  const { coordinates, direction, scrollCount, holdKeys } = input;
  console.log(
    `Scrolling: ${direction} ${scrollCount} times ${coordinates ? `at [${coordinates.x}, ${coordinates.y}]` : 'at current position'} ${holdKeys ? `with holdKeys: ${holdKeys}` : ''}`,
  );

  try {
    await fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'scroll',
        coordinates,
        direction,
        scrollCount,
        holdKeys,
      }),
    });
  } catch (error) {
    console.error('Error in scroll action:', error);
    throw error;
  }
}

async function typeKeys(input: { keys: string[]; delay?: number }): Promise<void> {
  const { keys, delay } = input;
  console.log(`Typing keys: ${keys}${delay ? ` with delay ${delay}ms` : ''}`);

  try {
    await fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'type_keys',
        keys,
        delay,
      }),
    });
  } catch (error) {
    console.error('Error in type_keys action:', error);
    throw error;
  }
}

async function pressKeys(input: { keys: string[]; press?: 'up' | 'down' }): Promise<void> {
  const press = input.press || 'down';
  const { keys } = input;
  
    // 定义修饰键（这些键需要按住）
    const modifierKeys = ['Shift', 'Control', 'Alt', 'Meta', 'Command', 'Ctrl', 'Cmd'];
    
    // 检查是否都是修饰键
    const allModifiers = keys.every(key => 
      modifierKeys.some(mod => key.toLowerCase().includes(mod.toLowerCase()))
    );
    
    // 如果不是修饰键，且 press='down'，自动按下并释放
    if (!allModifiers && press === 'down') {
      console.log(`Auto-releasing non-modifier keys: ${keys}`);
      await smartPressKeys(keys, 100);
      return;
    }
  console.log(`Pressing keys: ${keys} (${press})`);

  try {
    await fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'press_keys',
        keys,
        press,
      }),
    });
  } catch (error) {
    console.error('Error in press_keys action:', error);
    throw error;
  }
}


// 智能按键函数 - 自动按下并释放按键（适用于单次按键操作）
// 注意：此函数直接调用 API，避免与 pressKeys 形成循环调用
async function smartPressKeys(keys: string[], holdDuration: number = 100): Promise<void> {
  console.log(`Smart pressing keys: ${keys}`);
  
  try {
    // 按下按键
    await fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'press_keys',
        keys,
        press: 'down',
      }),
    });
    
    // 等待一小段时间
    await new Promise(resolve => setTimeout(resolve, holdDuration));
    
    // 释放按键
    await fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'press_keys',
        keys,
        press: 'up',
      }),
    });
    
    console.log(`Smart press completed: ${keys}`);
  } catch (error) {
    console.error('Error in smart press keys:', error);
    // 确保按键被释放
    try {
      await fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'press_keys',
          keys,
          press: 'up',
        }),
      });
    } catch (releaseError) {
      console.error('Error releasing keys:', releaseError);
    }
    throw error;
  }
}

async function typeText(input: { text: string; isSensitive?: boolean; delay?: number }): Promise<void> {
  const { text, isSensitive, delay } = input;
  console.log(`Typing text: ${isSensitive ? '●'.repeat(text.length) : text}${delay ? ` with delay ${delay}ms` : ''}`);

  try {
    // 计算合适的超时时间
    const timeout = calculateTextTimeout(text, delay);
    console.log(`Using timeout: ${timeout}ms for typing ${text.length} characters`);

    await fetchWithTimeout(
      `${BYTEBOT_DESKTOP_BASE_URL}/computer-use`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'type_text',
          text,
          delay,
        }),
      },
      timeout,
      3 // 最多重试3次
    );
  } catch (error) {
    console.error('Error in type_text action:', error);
    throw error;
  }
}

async function pasteText(input: { text: string; isSensitive?: boolean }): Promise<void> {
  const { text, isSensitive } = input;
  console.log(`Pasting text: ${isSensitive ? '●'.repeat(text.length) : text}`);

  try {
    await fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'paste_text',
        text,
      }),
    });
  } catch (error) {
    console.error('Error in paste_text action:', error);
    throw error;
  }
}

async function wait(input: { duration: number }): Promise<void> {
  const { duration } = input;
  console.log(`Waiting for ${duration}ms`);

  try {
    await fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'wait',
        duration,
      }),
    });
  } catch (error) {
    console.error('Error in wait action:', error);
    throw error;
  }
}

async function application(input: { application: string }): Promise<void> {
  const { application } = input;
  console.log(`Opening application: ${application}`);

  try {
    await fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'application',
        application,
      }),
    });
  } catch (error) {
    console.error('Error in application action:', error);
    throw error;
  }
}

async function readFile(input: { path: string }): Promise<{ success: boolean; data?: string; error?: string }> {
  const { path } = input;
  console.log(`Reading file: ${path}`);

  try {
    const response = await fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'read_file',
        path,
      }),
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error in read_file action:', error);
    return { success: false, error: error.message };
  }
}

export async function writeFile(input: {
  path: string;
  content: string;
}): Promise<{ success: boolean; message?: string }> {
  const { path, content } = input;
  console.log(`Writing file: ${path}`);

  try {
    // Content is always base64 encoded
    const base64Data = content;

    const response = await fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'write_file',
        path,
        data: base64Data,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to write file: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error in write_file action:', error);
    return {
      success: false,
      message: `Error writing file: ${error.message}`,
    };
  }
}