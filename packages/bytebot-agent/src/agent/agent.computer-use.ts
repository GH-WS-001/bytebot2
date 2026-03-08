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
 * 迭代逼近移动鼠标
 * 使用LiteLLM分析截图，识别鼠标和目标位置，迭代调整直到偏差小于阈值
 */

/**
 * 将 LLM 返回的目标位置转换为坐标
 * 支持单点坐标和边界框两种格式
 * @param target LLM 返回的目标位置（可能是单点或边界框）
 * @returns 单点坐标
 */
/**
 * 规范化坐标函数（处理数组等情况）
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

async function moveMouseWithIterationApproach(
  targetCoordinates: Coordinates,
  targetDescription: string,
  logger: Logger,
  maxIterations: number = 3,
  deviationThreshold: number = 20,
): Promise<{ success: boolean; iterations: number; finalDeviation: number; finalPosition: Coordinates }> {
    // 如果 coordinates 是字符串，先解析为对象
    if (typeof targetCoordinates === 'string') {
      try {
        targetCoordinates = JSON.parse(targetCoordinates);
        logger.debug('Parsed string coordinates:', targetCoordinates);
      } catch (e) {
        logger.error('Failed to parse coordinates string:', targetCoordinates);
      }
    }

  // 修复LLM返回的坐标格式错误: {"x": 704, 563} -> {"x": 704, "y": 563}
  if (targetCoordinates && typeof targetCoordinates.x === 'number' && typeof targetCoordinates.y === 'undefined') {
    const str = JSON.stringify(targetCoordinates);
    const match = str.match(/"x":(\d+),(\d+)/);
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

  // 规范化坐标函数（处理数组等情况）
  const normalize = (obj: any): Coordinates => {
    if (Array.isArray(obj.x) && obj.x.length === 2) return { x: obj.x[0], y: obj.x[1] };
    if (typeof obj.x === 'number' && typeof obj.y === 'number') return { x: obj.x, y: obj.y };
    throw new Error(`Invalid coordinate format: ${JSON.stringify(obj)}`);
  };

  logger.debug(`Starting iterative mouse movement to (${targetCoordinates.x}, ${targetCoordinates.y})`);
  logger.debug(`Target description: ${targetDescription}`);

  // 保存原始目标位置，始终使用它作为参考
  const originalTarget = { ...targetCoordinates };
  
  let iteration = 0;
  let currentDeviation = Infinity;
  let lastActualPosition: Coordinates | null = null;
    let originalBoundingBox: BoundingBox | null = null;  // 保存原始边界框信息

  // 使用本地LiteLLM代理进行截图分析
  const LITELLM_BASE_URL = process.env.LITELLM_BASE_URL || 'http://bytebot-bytebot-llm-proxy-1:4000';
  const LITELLM_MODEL = process.env.LITELLM_MODEL || 'qwen3.5:35b';

  logger.debug(`Using LiteLLM at ${LITELLM_BASE_URL} with model ${LITELLM_MODEL} for screenshot analysis`);

  let adaptiveThreshold = deviationThreshold;  // 默认使用基础阈值
  while (iteration < maxIterations && currentDeviation > deviationThreshold) {
    iteration++;
    logger.debug(`Iteration ${iteration}: Starting iteration`);

    try {
      // 1. 执行移动
      logger.debug(`Iteration ${iteration}: Moving mouse to target`);
      const moveResponse = await fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'move_mouse',
          coordinates: targetCoordinates,
        }),
      });

      // 2. 截图验证
      logger.debug(`Iteration ${iteration}: Taking screenshot for verification`);
      const screenshotResponse = await fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'screenshot',
          includeCursor: true,
        }),
      });

      const screenshotResult = await screenshotResponse.json();
      const screenshotBase64 = screenshotResult.image;

      // 3. 获取API报告的鼠标位置
      const positionResponse = await fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cursor_position',
        }),
      });
      const apiPosition = await positionResponse.json();

      logger.debug(`Iteration ${iteration}: API reports mouse at (${apiPosition.x}, ${apiPosition.y})`);

      // 4. 使用LiteLLM分析截图，识别鼠标位置和目标位置
      let detectedPosition: Coordinates;
      let detectedTarget: Coordinates;

      try {
        logger.debug(`Iteration ${iteration}: Analyzing screenshot with LiteLLM (${LITELLM_MODEL})`);

        // 调用LiteLLM的OpenAI兼容API
        const llmResponse = await fetch(`${LITELLM_BASE_URL}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: LITELLM_MODEL,
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:image/png;base64,${screenshotBase64}`,
                    },
                  },
                  {
                    type: 'text',
                    text: `Analyze this screenshot and identify two positions:

1. Mouse Cursor Position: Find the mouse cursor icon (small arrow/pointer). Give me its exact pixel coordinates (center of the cursor).

2. Target Element Position: ${targetDescription} Provide the bounding box of the target element (x, y coordinates of top-left corner, width, and height).

IMPORTANT: You must respond with ONLY a single JSON object, no other text, no markdown, no newlines. The JSON must exactly follow this format:
{"mousePosition":{"x":100,"y":200},"targetPosition":{"x":300,"y":400,"width":100,"height":50},"confidence":"high"}`,
                  },
                ],
              },
            ],
            max_tokens: 2000,
            temperature: 0.1,
          }),
        });

        if (!llmResponse.ok) {
          const errorText = await llmResponse.text();
          throw new Error(`LiteLLM request failed: ${llmResponse.status} ${errorText}`);
        }

        const llmResult = await llmResponse.json();
        const responseText = llmResult.choices[0].message.content;

        logger.debug(`Iteration ${iteration}: LiteLLM response: ${responseText}`);

        // 使用安全的JSON解析函数
        const parsed = safeParseLLMResponse(responseText);
        
        if (!parsed || !parsed.mousePosition || !parsed.targetPosition) {
          logger.error(`Iteration ${iteration}: Failed to parse AI response`);
          // 降级：尝试直接使用 API 位置并执行一次小幅度试探
          const tentativeDx = targetCoordinates.x - apiPosition.x;
          const tentativeDy = targetCoordinates.y - apiPosition.y;
          if (Math.abs(tentativeDx) + Math.abs(tentativeDy) > 20) {
            // 移动一小步
            targetCoordinates = {
              x: apiPosition.x + Math.sign(tentativeDx) * 20,
              y: apiPosition.y + Math.sign(tentativeDy) * 20,
            };
            logger.debug(`Iteration ${iteration}: Tentative move to (${targetCoordinates.x}, ${targetCoordinates.y})`);
          }
          lastActualPosition = apiPosition;
          await new Promise((resolve) => setTimeout(resolve, 200));
          continue;
        }

        const aiMouse = normalize(parsed.mousePosition);
          const aiTarget = normalizeTargetPosition(parsed.targetPosition);
          
          // 记录原始边界框信息（如果有）
          originalBoundingBox = parsed.targetPosition && parsed.targetPosition.width ? parsed.targetPosition : null;
          if (originalBoundingBox) {
            logger.debug(`Iteration ${iteration}: Target bounding box: x=${originalBoundingBox.x}, y=${originalBoundingBox.y}, width=${originalBoundingBox.width}, height=${originalBoundingBox.height}`);
          }
          
        const confidence = parsed.confidence || 'medium';

        logger.debug(
          `Iteration ${iteration}: AI detected mouse at (${aiMouse.x}, ${aiMouse.y}), target at (${aiTarget.x}, ${aiTarget.y}), confidence: ${confidence}`,
        );

        // 如果置信度过低，谨慎处理
        if (confidence === 'low') {
          logger.debug(`Iteration ${iteration}: Low confidence, reducing step size`);
          // 只移动偏差的一半
          const halfDx = (aiTarget.x - aiMouse.x) / 2;
          const halfDy = (aiTarget.y - aiMouse.y) / 2;
          targetCoordinates = {
            x: Math.round(apiPosition.x + halfDx),
            y: Math.round(apiPosition.y + halfDy),
          };
        } else {
          // 正常计算偏移
          const dx = aiTarget.x - aiMouse.x;
          const dy = aiTarget.y - aiMouse.y;
          targetCoordinates = {
            x: Math.round(apiPosition.x + dx),
            y: Math.round(apiPosition.y + dy),
          };
        }

        detectedPosition = aiMouse;
        detectedTarget = aiTarget;

        logger.debug(
          `Iteration ${iteration}: AI detected mouse at (${detectedPosition.x}, ${detectedPosition.y}), target at (${detectedTarget.x}, ${detectedTarget.y}), confidence: ${confidence}`,
        );
      } catch (aiError) {
        logger.error(`Iteration ${iteration}: AI analysis failed: ${aiError.message}`);
        logger.debug(`Iteration ${iteration}: Falling back to tentative move`);
        // 降级：尝试直接使用 API 位置并执行一次小幅度试探
        const tentativeDx = targetCoordinates.x - apiPosition.x;
        const tentativeDy = targetCoordinates.y - apiPosition.y;
        if (Math.abs(tentativeDx) + Math.abs(tentativeDy) > 20) {
          // 移动一小步
          targetCoordinates = {
            x: apiPosition.x + Math.sign(tentativeDx) * 20,
            y: apiPosition.y + Math.sign(tentativeDy) * 20,
          };
          logger.debug(`Iteration ${iteration}: Tentative move to (${targetCoordinates.x}, ${targetCoordinates.y})`);
        }
        lastActualPosition = apiPosition;
        await new Promise((resolve) => setTimeout(resolve, 200));
        continue;
      }

      logger.debug(`Iteration ${iteration}: Using detected mouse at (${detectedPosition.x}, ${detectedPosition.y})`);

      // 5. 计算偏差（截图上的偏差）
      // 步骤3: 用目标位置减去鼠标位置得到偏差量
      const dx = detectedTarget.x - detectedPosition.x;
      const dy = detectedTarget.y - detectedPosition.y;
      currentDeviation = Math.sqrt(dx * dx + dy * dy);

        // 计算自适应阈值（基于边界框大小）- 方案一（主要）
        adaptiveThreshold = calculateAdaptiveThreshold(originalBoundingBox, deviationThreshold);
        
        // 检查鼠标是否在边界框附近 - 方案二（辅助，仅对大目标使用）
        const isLargeTarget = originalBoundingBox && originalBoundingBox.width > 100 && originalBoundingBox.height > 50;
        const isNearBoundingBox = isLargeTarget && isMouseNearBoundingBox(detectedPosition, originalBoundingBox, 5);
        
        logger.debug(`Iteration ${iteration}: Screenshot deviation = ${currentDeviation.toFixed(2)}px (dx=${dx}, dy=${dy}), adaptive threshold = ${adaptiveThreshold.toFixed(2)}px${isLargeTarget ? ', near bounding box = ' + isNearBoundingBox : ''}`);
      // 步骤4: 用API位置加上偏差量得到最终要设置的鼠标位置
      const newTargetX = apiPosition.x + dx;
      const newTargetY = apiPosition.y + dy;

      targetCoordinates = {
        x: Math.round(newTargetX),
        y: Math.round(newTargetY),
      };

      logger.debug(`Iteration ${iteration}: New target position: API(${apiPosition.x}, ${apiPosition.y}) + offset(${dx}, ${dy}) = (${targetCoordinates.x}, ${targetCoordinates.y})`);

      lastActualPosition = apiPosition;

      // 检查是否满足停止条件
      if (currentDeviation <= adaptiveThreshold) {
        logger.debug(`Iteration ${iteration}: Deviation within adaptive threshold, stopping`);
        break;
      }
      
      if (isNearBoundingBox) {
        logger.debug(`Iteration ${iteration}: Mouse is within target bounding box, stopping`);
        break;
      }
      
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      logger.error(`Iteration ${iteration} failed: ${error.message}`);
      break;
    }
  }

    const success = currentDeviation <= adaptiveThreshold;
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
          button: block.input.button,
          clickCount: block.input.clickCount || 1,
          holdKeys: block.input.holdKeys,
        });
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
        // 滚动前先移动到目标位置
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
                text: `ERROR: Mouse movement failed. Deviation ${moveResult.finalDeviation.toFixed(2)}px exceeds threshold. Scroll not executed.`,
              },
            ],
            is_error: true,
          };
        }
        await scroll({
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
}): Promise<void> {
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

async function typeText(input: { text: string; isSensitive?: boolean; delay?: number }): Promise<void> {
  const { text, isSensitive, delay } = input;
  console.log(`Typing text: ${isSensitive ? '●'.repeat(text.length) : text}${delay ? ` with delay ${delay}ms` : ''}`);

  try {
    await fetch(`${BYTEBOT_DESKTOP_BASE_URL}/computer-use`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'type_text',
        text,
        delay,
      }),
    });
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
