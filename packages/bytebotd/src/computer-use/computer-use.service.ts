import { Injectable, Logger } from '@nestjs/common';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { NutService } from '../nut/nut.service';
import {
  ComputerAction,
  MoveMouseAction,
  TraceMouseAction,
  ClickMouseAction,
  PressMouseAction,
  DragMouseAction,
  ScrollAction,
  TypeKeysAction,
  PressKeysAction,
  TypeTextAction,
  ApplicationAction,
  Application,
  PasteTextAction,
  WriteFileAction,
  ReadFileAction,
  Coordinates,
} from '@bytebot/shared';
import {
  applyCoordinateCorrection,
  applyCoordinateCorrectionToPath,
  CoordinateCorrectionConfig,
} from '@bytebot/shared/dist/utils/coordinateCorrection.utils';

@Injectable()
export class ComputerUseService {
  private readonly logger = new Logger(ComputerUseService.name);
  private coordinateCorrectionConfig: CoordinateCorrectionConfig | null = null;

  constructor(private readonly nutService: NutService) {}

  /**
   * 设置坐标修正配置
   * 
   * @param config 坐标修正配置
   */
  setCoordinateCorrection(config: CoordinateCorrectionConfig): void {
    this.logger.log(`Setting coordinate correction config`);
    this.logger.debug(`API Mouse Position: (${config.apiMousePosition.x}, ${config.apiMousePosition.y})`);
    this.logger.debug(`Screenshot Mouse Position: (${config.screenshotMousePosition.x}, ${config.screenshotMousePosition.y})`);
    this.coordinateCorrectionConfig = config;
  }

  /**
   * 清除坐标修正配置
   */
  clearCoordinateCorrection(): void {
    this.logger.log(`Clearing coordinate correction config`);
    this.coordinateCorrectionConfig = null;
  }

  /**
   * 应用坐标修正到目标位置
   * 
   * @param targetPosition 目标位置
   * @returns 修正后的坐标
   */
  private applyCorrectionIfNeeded(targetPosition: Coordinates): Coordinates {
    if (!this.coordinateCorrectionConfig) {
      return targetPosition;
    }

    const corrected = applyCoordinateCorrection(
      targetPosition,
      this.coordinateCorrectionConfig
    );
    
    this.logger.debug(
      `Coordinate correction applied: (${targetPosition.x}, ${targetPosition.y}) -> (${corrected.x}, ${corrected.y})`
    );
    
    return corrected;
  }

  /**
   * 迭代调整鼠标位置直到偏差小于阈值
   * 
   * 流程：
   * 1. 移动到修正后的位置
   * 2. 截图（包含鼠标光标）
   * 3. 返回截图给调用方验证
   * 4. 调用方分析截图中的鼠标位置和目标位置偏差
   * 5. 如果偏差 > 阈值，调用方再次请求调整
   * 
   * @param targetPosition 目标位置
   * @param maxDeviationThreshold 最大偏差阈值（像素），默认5
   * @param maxIterations 最大迭代次数，默认10
   * @returns 最终位置、偏差信息和验证截图
   */
  async moveMouseWithIteration(
    targetPosition: Coordinates,
    maxDeviationThreshold: number = 5,
    maxIterations: number = 10
  ): Promise<{ 
    position: Coordinates; 
    deviation: number; 
    iterations: number;
    screenshot?: string;
    apiMousePosition?: Coordinates;
  }> {
    let currentPosition = this.applyCorrectionIfNeeded(targetPosition);
    let iteration = 0;
    
    this.logger.log(
      `Starting iterative mouse movement to target (${targetPosition.x}, ${targetPosition.y})`
    );
    this.logger.debug(`Max deviation threshold: ${maxDeviationThreshold}px, Max iterations: ${maxIterations}`);
    
    while (iteration < maxIterations) {
      // 移动到当前位置
      await this.nutService.mouseMoveEvent(currentPosition);
      
      // 等待一下让系统稳定
      await this.delay(100);
      
      // 获取API报告的鼠标位置
      const apiPosition = await this.nutService.getCursorPosition();
      
      // 截图（包含鼠标光标）用于验证
      const screenshotBuffer = await this.nutService.screendump(true);
      const screenshotBase64 = screenshotBuffer.toString('base64');
      
      // 计算API位置的偏差
      const dx = targetPosition.x - apiPosition.x;
      const dy = targetPosition.y - apiPosition.y;
      const deviation = Math.sqrt(dx * dx + dy * dy);
      
      this.logger.debug(
        `Iteration ${iteration + 1}: API Position (${apiPosition.x}, ${apiPosition.y}), Deviation: ${deviation.toFixed(2)}px`
      );
      
      // 返回结果，包含截图供调用方验证
      // 注意：调用方需要从截图中识别实际的鼠标位置和目标位置
      // 然后计算真实偏差，决定是否需要继续迭代
      return {
        position: apiPosition,
        deviation,
        iterations: iteration + 1,
        screenshot: screenshotBase64,
        apiMousePosition: apiPosition,
      };
      
      // 下面的代码暂时注释，因为需要调用方从截图验证后决定是否继续
      /*
      // 如果偏差满足要求，返回结果
      if (deviation <= maxDeviationThreshold) {
        this.logger.log(
          `Target reached with deviation ${deviation.toFixed(2)}px after ${iteration + 1} iterations`
        );
        return {
          position: apiPosition,
          deviation,
          iterations: iteration + 1,
          screenshot: screenshotBase64,
        };
      }
      
      // 调整位置：向目标方向移动偏差距离
      if (deviation > 0) {
        const adjustmentX = (dx / deviation) * (deviation - maxDeviationThreshold + 0.5);
        const adjustmentY = (dy / deviation) * (deviation - maxDeviationThreshold + 0.5);
        
        currentPosition = {
          x: Math.round(currentPosition.x + adjustmentX),
          y: Math.round(currentPosition.y + adjustmentY),
        };
      }
      
      iteration++;
      */
    }
    
    // 达到最大迭代次数，返回最后的位置和截图
    const finalPosition = await this.nutService.getCursorPosition();
    const screenshotBuffer = await this.nutService.screendump(true);
    const dx = targetPosition.x - finalPosition.x;
    const dy = targetPosition.y - finalPosition.y;
    const finalDeviation = Math.sqrt(dx * dx + dy * dy);
    
    this.logger.warn(
      `Max iterations reached. Final deviation: ${finalDeviation.toFixed(2)}px`
    );
    
    return {
      position: finalPosition,
      deviation: finalDeviation,
      iterations: maxIterations,
      screenshot: screenshotBuffer.toString('base64'),
      apiMousePosition: finalPosition,
    };
  }

  /**
   * 应用坐标修正到路径
   * 
   * @param path 路径坐标数组
   * @returns 修正后的路径
   */
  private applyCorrectionToPathIfNeeded(path: Coordinates[]): Coordinates[] {
    if (!this.coordinateCorrectionConfig) {
      return path;
    }

    const correctedPath = applyCoordinateCorrectionToPath(
      path,
      this.coordinateCorrectionConfig
    );
    
    this.logger.debug(
      `Coordinate correction applied to path with ${path.length} points`
    );
    
    return correctedPath;
  }

  async action(params: ComputerAction): Promise<any> {
    this.logger.log(`Executing computer action: ${params.action}`);

    switch (params.action) {
      case 'move_mouse': {
        await this.moveMouse(params);
        break;
      }
      case 'trace_mouse': {
        await this.traceMouse(params);
        break;
      }
      case 'click_mouse': {
        await this.clickMouse(params);
        break;
      }
      case 'press_mouse': {
        await this.pressMouse(params);
        break;
      }
      case 'drag_mouse': {
        await this.dragMouse(params);
        break;
      }

      case 'scroll': {
        await this.scroll(params);
        break;
      }
      case 'type_keys': {
        await this.typeKeys(params);
        break;
      }
      case 'press_keys': {
        await this.pressKeys(params);
        break;
      }
      case 'type_text': {
        await this.typeText(params);
        break;
      }
      case 'paste_text': {
        await this.pasteText(params);
        break;
      }
      case 'wait': {
        const waitParams = params;
        await this.delay(waitParams.duration);
        break;
      }
      case 'screenshot':
        return this.screenshot(params);

      case 'cursor_position':
        return this.cursor_position();

      case 'application': {
        await this.application(params);
        break;
      }

      case 'write_file': {
        return this.writeFile(params);
      }

      case 'read_file': {
        return this.readFile(params);
      }

      default:
        throw new Error(
          `Unsupported computer action: ${(params as any).action}`,
        );
    }
  }

  private async moveMouse(action: MoveMouseAction): Promise<void> {
    const correctedCoordinates = this.applyCorrectionIfNeeded(action.coordinates);
    await this.nutService.mouseMoveEvent(correctedCoordinates);
  }

  private async traceMouse(action: TraceMouseAction): Promise<void> {
    const { path, holdKeys } = action;
    const correctedPath = this.applyCorrectionToPathIfNeeded(path);

    // Move to the first coordinate
    await this.nutService.mouseMoveEvent(correctedPath[0]);

    // Hold keys if provided
    if (holdKeys) {
      await this.nutService.holdKeys(holdKeys, true);
    }

    // Move to each coordinate in the path
    for (const coordinates of correctedPath) {
      await this.nutService.mouseMoveEvent(coordinates);
    }

    // Release hold keys
    if (holdKeys) {
      await this.nutService.holdKeys(holdKeys, false);
    }
  }

  private async clickMouse(action: ClickMouseAction): Promise<void> {
    const { coordinates, button, holdKeys, clickCount } = action;

    // Move to coordinates if provided
    if (coordinates) {
      const correctedCoordinates = this.applyCorrectionIfNeeded(coordinates);
      await this.nutService.mouseMoveEvent(correctedCoordinates);
    }

    // Hold keys if provided
    if (holdKeys) {
      await this.nutService.holdKeys(holdKeys, true);
    }

    // Perform clicks
    if (clickCount > 1) {
      // Perform multiple clicks
      for (let i = 0; i < clickCount; i++) {
        await this.nutService.mouseClickEvent(button);
        await this.delay(150);
      }
    } else {
      // Perform a single click
      await this.nutService.mouseClickEvent(button);
    }

    // Release hold keys
    if (holdKeys) {
      await this.nutService.holdKeys(holdKeys, false);
    }
  }

  private async pressMouse(action: PressMouseAction): Promise<void> {
    const { coordinates, button, press } = action;

    // Move to coordinates if provided
    if (coordinates) {
      const correctedCoordinates = this.applyCorrectionIfNeeded(coordinates);
      await this.nutService.mouseMoveEvent(correctedCoordinates);
    }

    // Perform press
    if (press === 'down') {
      await this.nutService.mouseButtonEvent(button, true);
    } else {
      await this.nutService.mouseButtonEvent(button, false);
    }
  }

  private async dragMouse(action: DragMouseAction): Promise<void> {
    const { path, button, holdKeys } = action;
    const correctedPath = this.applyCorrectionToPathIfNeeded(path);

    // Move to the first coordinate
    await this.nutService.mouseMoveEvent(correctedPath[0]);

    // Hold keys if provided
    if (holdKeys) {
      await this.nutService.holdKeys(holdKeys, true);
    }

    // Perform drag
    await this.nutService.mouseButtonEvent(button, true);
    for (const coordinates of correctedPath) {
      await this.nutService.mouseMoveEvent(coordinates);
    }
    await this.nutService.mouseButtonEvent(button, false);

    // Release hold keys
    if (holdKeys) {
      await this.nutService.holdKeys(holdKeys, false);
    }
  }

  private async scroll(action: ScrollAction): Promise<void> {
    const { coordinates, direction, scrollCount, holdKeys } = action;

    // Move to coordinates if provided
    if (coordinates) {
      const correctedCoordinates = this.applyCorrectionIfNeeded(coordinates);
      await this.nutService.mouseMoveEvent(correctedCoordinates);
    }

    // Hold keys if provided
    if (holdKeys) {
      await this.nutService.holdKeys(holdKeys, true);
    }

    // Perform scroll
    for (let i = 0; i < scrollCount; i++) {
      await this.nutService.mouseWheelEvent(direction, 1);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    // Release hold keys
    if (holdKeys) {
      await this.nutService.holdKeys(holdKeys, false);
    }
  }

  private async typeKeys(action: TypeKeysAction): Promise<void> {
    const { keys, delay } = action;
    await this.nutService.sendKeys(keys, delay);
  }

  private async pressKeys(action: PressKeysAction): Promise<void> {
    const { keys, press } = action;
    await this.nutService.holdKeys(keys, press === 'down');
  }

  private async typeText(action: TypeTextAction): Promise<void> {
    const { text, delay } = action;
    await this.nutService.typeText(text, delay);
  }

  private async pasteText(action: PasteTextAction): Promise<void> {
    const { text } = action;
    await this.nutService.pasteText(text);
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

    async screenshot(params?: { includeCursor?: boolean }): Promise<{ image: string }> {
      this.logger.log(`Taking screenshot${params?.includeCursor ? " with cursor" : ""}`);
      const buffer = await this.nutService.screendump(params?.includeCursor);
      return { image: `${buffer.toString("base64")}` };
    }

  private async cursor_position(): Promise<{ x: number; y: number }> {
    this.logger.log(`Getting cursor position`);
    return await this.nutService.getCursorPosition();
  }

  private async application(action: ApplicationAction): Promise<void> {
    const execAsync = promisify(exec);

    // Helper to spawn a command and forget about it
    const spawnAndForget = (
      command: string,
      args: string[],
      options: Record<string, any> = {},
    ): void => {
      const child = spawn(command, args, {
        env: { ...process.env, DISPLAY: ':0.0' }, // ensure DISPLAY is set for GUI tools
        stdio: 'ignore',
        detached: true,
        ...options,
      });
      child.unref(); // Allow the parent process to exit independently
    };

    if (action.application === 'desktop') {
      spawnAndForget('sudo', ['-u', 'user', 'wmctrl', '-k', 'on']);
      return;
    }

    const commandMap: Record<string, string> = {
      firefox: 'firefox-esr',
      '1password': '1password',
      thunderbird: 'thunderbird',
      vscode: 'code',
      terminal: 'xfce4-terminal',
      directory: 'thunar',
    };

    const processMap: Record<Application, string> = {
      firefox: 'Navigator.firefox-esr',
      '1password': '1password.1Password',
      thunderbird: 'Mail.thunderbird',
      vscode: 'code.Code',
      terminal: 'xfce4-terminal.Xfce4-Terminal',
      directory: 'Thunar',
      desktop: 'xfdesktop.Xfdesktop',
    };

    // check if the application is already open using wmctrl -lx
    let appOpen = false;
    try {
      const { stdout } = await execAsync(
        `sudo -u user wmctrl -lx | grep ${processMap[action.application]}`,
        { timeout: 5000 }, // 5 second timeout
      );
      appOpen = stdout.trim().length > 0;
    } catch (error: any) {
      // grep returns exit code 1 when no match is found – treat as "not open"
      // Also handle timeout errors
      if (error.code !== 1 && !error.message?.includes('timeout')) {
        throw error;
      }
    }

    if (appOpen) {
      this.logger.log(`Application ${action.application} is already open`);

      // Fire and forget - activate window
      spawnAndForget('sudo', [
        '-u',
        'user',
        'wmctrl',
        '-x',
        '-a',
        processMap[action.application],
      ]);

      // Fire and forget - maximize window
      spawnAndForget('sudo', [
        '-u',
        'user',
        'wmctrl',
        '-x',
        '-r',
        processMap[action.application],
        '-b',
        'add,maximized_vert,maximized_horz',
      ]);

      return;
    }

    // application is not open, open it - fire and forget
    spawnAndForget('sudo', [
      '-u',
      'user',
      'nohup',
      commandMap[action.application],
    ]);

    this.logger.log(`Application ${action.application} launched`);

    // Just return immediately
    return;
  }

  private async writeFile(
    action: WriteFileAction,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const execAsync = promisify(exec);

      // Decode base64 data
      const buffer = Buffer.from(action.data, 'base64');

      // Resolve path - if relative, make it relative to user's home directory
      let targetPath = action.path;
      if (!path.isAbsolute(targetPath)) {
        targetPath = path.join('/home/user/Desktop', targetPath);
      }

      // Ensure directory exists using sudo
      const dir = path.dirname(targetPath);
      try {
        await execAsync(`sudo mkdir -p "${dir}"`);
      } catch (error) {
        // Directory might already exist, which is fine
        this.logger.debug(`Directory creation: ${error.message}`);
      }

      // Write to a temporary file first
      const tempFile = `/tmp/bytebot_temp_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      await fs.writeFile(tempFile, buffer);

      // Move the file to the target location using sudo
      try {
        await execAsync(`sudo cp "${tempFile}" "${targetPath}"`);
        await execAsync(`sudo chown user:user "${targetPath}"`);
        await execAsync(`sudo chmod 644 "${targetPath}"`);
        // Clean up temp file
        await fs.unlink(tempFile).catch(() => {});
      } catch (error) {
        // Clean up temp file on error
        await fs.unlink(tempFile).catch(() => {});
        throw error;
      }

      this.logger.log(`File written successfully to: ${targetPath}`);
      return {
        success: true,
        message: `File written successfully to: ${targetPath}`,
      };
    } catch (error) {
      this.logger.error(`Error writing file: ${error.message}`, error.stack);
      return {
        success: false,
        message: `Error writing file: ${error.message}`,
      };
    }
  }

  private async readFile(action: ReadFileAction): Promise<{
    success: boolean;
    data?: string;
    name?: string;
    size?: number;
    mediaType?: string;
    message?: string;
  }> {
    try {
      const execAsync = promisify(exec);

      // Resolve path - if relative, make it relative to user's home directory
      let targetPath = action.path;
      if (!path.isAbsolute(targetPath)) {
        targetPath = path.join('/home/user/Desktop', targetPath);
      }

      // Copy file to temp location using sudo to read it
      const tempFile = `/tmp/bytebot_read_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      try {
        // Copy the file to a temporary location we can read
        await execAsync(`sudo cp "${targetPath}" "${tempFile}"`);
        await execAsync(`sudo chmod 644 "${tempFile}"`);

        // Read file as buffer from temp location
        const buffer = await fs.readFile(tempFile);

        // Get file stats for size using sudo
        const { stdout: statOutput } = await execAsync(
          `sudo stat -c "%s" "${targetPath}"`,
        );
        const fileSize = parseInt(statOutput.trim(), 10);

        // Clean up temp file
        await fs.unlink(tempFile).catch(() => {});

        // Convert to base64
        const base64Data = buffer.toString('base64');

        // Extract filename from path
        const fileName = path.basename(targetPath);

        // Determine media type based on file extension
        const ext = path.extname(targetPath).toLowerCase().slice(1);
        const mimeTypes: Record<string, string> = {
          pdf: 'application/pdf',
          docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          doc: 'application/msword',
          txt: 'text/plain',
          html: 'text/html',
          json: 'application/json',
          xml: 'text/xml',
          csv: 'text/csv',
          rtf: 'application/rtf',
          odt: 'application/vnd.oasis.opendocument.text',
          epub: 'application/epub+zip',
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          webp: 'image/webp',
          gif: 'image/gif',
          svg: 'image/svg+xml',
        };

        const mediaType = mimeTypes[ext] || 'application/octet-stream';

        this.logger.log(`File read successfully from: ${targetPath}`);
        return {
          success: true,
          data: base64Data,
          name: fileName,
          size: fileSize,
          mediaType: mediaType,
        };
      } catch (error) {
        // Clean up temp file on error
        await fs.unlink(tempFile).catch(() => {});
        throw error;
      }
    } catch (error) {
      this.logger.error(`Error reading file: ${error.message}`, error.stack);
      return {
        success: false,
        message: `Error reading file: ${error.message}`,
      };
    }
  }
}
