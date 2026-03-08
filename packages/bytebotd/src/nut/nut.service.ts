  // src/nut/nut.service.ts
  import { Injectable, Logger } from '@nestjs/common';
  import {
    keyboard,
    mouse,
    Point,
    screen,
    Key,
    Button,
    FileType,
  } from '@nut-tree-fork/nut-js';
  import { spawn } from 'child_process';
  import * as path from 'path';
  import * as fs from 'fs/promises';
  import * as sharp from 'sharp';
  
  /**
   * Enum representing key codes supported by nut-js.
   * Maps to the same structure as QKeyCode for compatibility.
   */
  
  const XKeySymToNutKeyMap: Record<string, Key> = {
    // Alphanumeric Keys
    '1': Key.Num1,
    '2': Key.Num2,
    '3': Key.Num3,
    '4': Key.Num4,
    '5': Key.Num5,
    '6': Key.Num6,
    '7': Key.Num7,
    '8': Key.Num8,
    '9': Key.Num9,
    '0': Key.Num0,
    bracketleft: Key.LeftBracket,
    bracketright: Key.RightBracket,
    apostrophe: Key.Quote,
  
    // Modifier Keys
    Shift: Key.LeftShift,
    ctrl: Key.LeftControl,
    Control: Key.LeftControl,
    Super: Key.LeftSuper,
    Alt: Key.LeftAlt,
    Meta: Key.LeftMeta,
    Shift_L: Key.LeftShift,
    Shift_R: Key.RightShift,
    Control_L: Key.LeftControl,
    Control_R: Key.RightControl,
    Super_L: Key.LeftSuper,
    Super_R: Key.RightSuper,
    Alt_L: Key.LeftAlt,
    Alt_R: Key.RightAlt,
    Meta_L: Key.LeftMeta,
    Meta_R: Key.RightMeta,
  
    // Lock and Toggle Keys
    Caps_Lock: Key.CapsLock,
    Num_Lock: Key.NumLock,
    Scroll_Lock: Key.ScrollLock,
  
    // Editing Keys
    Page_Up: Key.PageUp,
    Page_Down: Key.PageDown,
  
    // Numpad Keys
    KP_0: Key.NumPad0,
    KP_1: Key.NumPad1,
    KP_2: Key.NumPad2,
    KP_3: Key.NumPad3,
    KP_4: Key.NumPad4,
    KP_5: Key.NumPad5,
    KP_6: Key.NumPad6,
    KP_7: Key.NumPad7,
    KP_8: Key.NumPad8,
    KP_9: Key.NumPad9,
    KP_Add: Key.Add,
    KP_Subtract: Key.Subtract,
    KP_Multiply: Key.Multiply,
    KP_Divide: Key.Divide,
    KP_Decimal: Key.Decimal,
    KP_Equal: Key.NumPadEqual,
  
    // Multimedia Keys
    AudioLowerVolume: Key.AudioVolDown,
    AudioRaiseVolume: Key.AudioVolUp,
    AudioRandomPlay: Key.AudioRandom,
  };
  
  const XKeySymToNutKeyMapLowercase: Record<string, Key> = Object.entries(
    XKeySymToNutKeyMap,
  ).reduce(
    (map, [key, value]) => {
      map[key.toLowerCase()] = value;
      return map;
    },
    {} as Record<string, Key>,
  );
  
  const NutKeyMap = Object.entries(Key)
    .filter(([name]) => isNaN(Number(name)))
    .reduce(
      (map, [name, value]) => {
        map[name] = value as Key;
        return map;
      },
      {} as Record<string, Key>,
    );
  
  // Create a map of lowercase keys to nutjs keys
  const NutKeyMapLowercase: Record<string, Key> = Object.entries(Key)
    // we only want the string→number pairs (filter out the reverse numeric keys)
    .filter(([name]) => isNaN(Number(name)))
    .reduce(
      (map, [name, value]) => {
        map[name.toLowerCase()] = value as Key;
        return map;
      },
      {} as Record<string, Key>,
    );
  
  @Injectable()
  export class NutService {
    private readonly logger = new Logger(NutService.name);
    private screenshotDir: string;
    private cursorImagePath: string;
  
    constructor() {
      // Initialize nut-js settings
      mouse.config.autoDelayMs = 100;
      keyboard.config.autoDelayMs = 100;
  
      // Create screenshot directory if it doesn't exist
      this.screenshotDir = path.join('/tmp', 'bytebot-screenshots');
      fs.mkdir(this.screenshotDir, { recursive: true })
        .catch((err) => {
          this.logger.error(
            `Failed to create screenshot directory: ${err.message}`,
          );
        });
  
      // Set cursor image path
      // In Docker: /bytebot/bytebotd/dist/nut/nut.service.js -> /bytebot/bytebotd/assets/
      // In Dev: /packages/bytebotd/dist/nut/nut.service.js -> /packages/bytebotd/assets/
      this.cursorImagePath = path.join(__dirname, '../../assets/cursors/default.png');
    }
  
    /**
     * Sends key events to the computer.
     *
     * @param keys An array of key strings.
     * @param delay Delay between pressing and releasing keys in ms.
     */
    async sendKeys(keys: string[], delay: number = 100): Promise<any> {
      this.logger.log(`Sending keys: ${keys}`);
  
      try {
        const nutKeys = keys.map((key) => this.validateKey(key));
        await keyboard.pressKey(...nutKeys);
        await this.delay(delay);
        await keyboard.releaseKey(...nutKeys);
        return { success: true };
      } catch (error) {
        throw new Error(`Failed to send keys: ${error.message}`);
      }
    }
  
    /**
     * Holds or releases keys.
     *
     * @param keys An array of key strings.
     * @param down True to press the keys down, false to release them.
     */
    async holdKeys(keys: string[], down: boolean): Promise<any> {
      try {
        for (const key of keys) {
          const nutKey = this.validateKey(key);
          if (down) {
            await keyboard.pressKey(nutKey);
          } else {
            await keyboard.releaseKey(nutKey);
          }
        }
        return { success: true };
      } catch (error) {
        throw new Error(`Failed to hold keys: ${error.message}`);
      }
    }
  
    /**
     * Validates a key and returns the corresponding nut-js key.
     *
     * @param key The key to validate.
     * @returns The corresponding nut-js key.
     */
    private validateKey(key: string): Key {
      // Try exact matches first
      let nutKey: Key | undefined = XKeySymToNutKeyMap[key] || NutKeyMap[key];
  
      // If not found, try case-insensitive matching
      if (nutKey === undefined) {
        const lowerKey = key.toLowerCase();
  
        // Try to find case-insensitive match in XKeySymToNutKeyMapLowercase or NutKeyMapLowercase
        nutKey =
          XKeySymToNutKeyMapLowercase[lowerKey] || NutKeyMapLowercase[lowerKey];
      }
  
      if (nutKey === undefined) {
        throw new Error(
          `Invalid key: '${key}'. Key not found in available key mappings.`,
        );
      }
  
      return nutKey;
    }
  
    /**
     * Types text on the keyboard.
     *
     * @param text The text to type.
     * @param delayMs Delay between keypresses in ms.
     */
    async typeText(text: string, delayMs: number = 0): Promise<void> {
      this.logger.log(`Typing text: ${text}`);
  
      try {
        for (let i = 0; i < text.length; i++) {
          const char = text[i];
          const keyInfo = this.charToKeyInfo(char);
          if (keyInfo) {
            if (keyInfo.withShift) {
              // Hold shift key, press the character key, and release shift key
              await keyboard.pressKey(Key.LeftShift, keyInfo.keyCode);
              await keyboard.releaseKey(Key.LeftShift, keyInfo.keyCode);
            } else {
              await keyboard.pressKey(keyInfo.keyCode);
              await keyboard.releaseKey(keyInfo.keyCode);
            }
            if (delayMs > 0 && i < text.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
          } else {
            throw new Error(`No key mapping found for character: ${char}`);
          }
        }
      } catch (error) {
        throw new Error(`Failed to type text: ${error.message}`);
      }
    }
  
    async pasteText(text: string): Promise<void> {
      this.logger.log(`Pasting text: ${text}`);
  
      try {
        // Copy text to clipboard using xclip via spawn
        await new Promise<void>((resolve, reject) => {
          const child = spawn('xclip', ['-selection', 'clipboard'], {
            env: { ...process.env, DISPLAY: ':0.0' },
            stdio: ['pipe', 'ignore', 'inherit'],
          });
  
          child.once('error', reject);
          child.once('close', (code) => {
            code === 0
              ? resolve()
              : reject(new Error(`xclip exited with code ${code}`));
          });
  
          child.stdin.write(text);
          child.stdin.end();
        });
  
        // brief pause to ensure clipboard owner is set
        await new Promise((resolve) => setTimeout(resolve, 100));
  
        await keyboard.pressKey(Key.LeftControl, Key.V);
        await keyboard.releaseKey(Key.LeftControl, Key.V);
      } catch (error) {
        throw new Error(`Failed to paste text: ${error.message}`);
      }
    }
  
    /**
     * Converts a character to its corresponding key information.
     *
     * @param char The character to convert.
     * @returns An object containing the keyCode and whether shift is needed, or null if no mapping exists.
     */
    private charToKeyInfo(
      char: string,
    ): { keyCode: Key; withShift: boolean } | null {
      // Handle lowercase letters
      if (/^[a-z]$/.test(char)) {
        return { keyCode: this.validateKey(char), withShift: false };
      }
  
      // Handle uppercase letters (need to send shift + lowercase)
      if (/^[A-Z]$/.test(char)) {
        return {
          keyCode: this.validateKey(char.toLowerCase()),
          withShift: true,
        };
      }
  
      // Handle numbers
      if (/^[0-9]$/.test(char)) {
        return { keyCode: this.validateKey(char), withShift: false };
      }
  
      // Handle special characters
      const specialCharMap: Record<string, { keyCode: Key; withShift: boolean }> =
        {
          ' ': { keyCode: Key.Space, withShift: false },
          '.': { keyCode: Key.Period, withShift: false },
          ',': { keyCode: Key.Comma, withShift: false },
          ';': { keyCode: Key.Semicolon, withShift: false },
          "'": { keyCode: Key.Quote, withShift: false },
          '`': { keyCode: Key.Grave, withShift: false },
          '-': { keyCode: Key.Minus, withShift: false },
          '=': { keyCode: Key.Equal, withShift: false },
          '[': { keyCode: Key.LeftBracket, withShift: false },
          ']': { keyCode: Key.RightBracket, withShift: false },
          '\\': { keyCode: Key.Backslash, withShift: false },
          '/': { keyCode: Key.Slash, withShift: false },
  
          // Characters that require shift
          '!': { keyCode: Key.Num1, withShift: true },
          '@': { keyCode: Key.Num2, withShift: true },
          '#': { keyCode: Key.Num3, withShift: true },
          $: { keyCode: Key.Num4, withShift: true },
          '%': { keyCode: Key.Num5, withShift: true },
          '^': { keyCode: Key.Num6, withShift: true },
          '&': { keyCode: Key.Num7, withShift: true },
          '*': { keyCode: Key.Num8, withShift: true },
          '(': { keyCode: Key.Num9, withShift: true },
          ')': { keyCode: Key.Num0, withShift: true },
          _: { keyCode: Key.Minus, withShift: true },
          '+': { keyCode: Key.Equal, withShift: true },
          '{': { keyCode: Key.LeftBracket, withShift: true },
          '}': { keyCode: Key.RightBracket, withShift: true },
          '|': { keyCode: Key.Backslash, withShift: true },
          ':': { keyCode: Key.Semicolon, withShift: true },
          '"': { keyCode: Key.Quote, withShift: true },
          '<': { keyCode: Key.Comma, withShift: true },
          '>': { keyCode: Key.Period, withShift: true },
          '?': { keyCode: Key.Slash, withShift: true },
          '~': { keyCode: Key.Grave, withShift: true },
          '\n': { keyCode: Key.Enter, withShift: false },
        };
  
      return specialCharMap[char] || null;
    }
  
    /**
     * Moves the mouse to specified coordinates.
     *
     * @param coordinates The x and y coordinates.
     */
    async mouseMoveEvent({ x, y }: { x: number; y: number }): Promise<any> {
      this.logger.log(`Moving mouse to coordinates: (${x}, ${y})`);
      try {
        const point = new Point(x, y);
        await mouse.setPosition(point);
        return { success: true };
      } catch (error) {
        throw new Error(`Failed to move mouse: ${error.message}`);
      }
    }
  
    async mouseClickEvent(button: 'left' | 'right' | 'middle'): Promise<any> {
      this.logger.log(`Clicking mouse button: ${button}`);
      try {
        switch (button) {
          case 'left':
            await mouse.click(Button.LEFT);
            break;
          case 'right':
            await mouse.click(Button.RIGHT);
            break;
          case 'middle':
            await mouse.click(Button.MIDDLE);
            break;
        }
        return { success: true };
      } catch (error) {
        throw new Error(`Failed to click mouse button: ${error.message}`);
      }
    }
  
    /**
     * Presses or releases a mouse button.
     *
     * @param button The mouse button ('left', 'right', or 'middle').
     * @param pressed True to press, false to release.
     */
    async mouseButtonEvent(
      button: 'left' | 'right' | 'middle',
      pressed: boolean,
    ): Promise<any> {
      this.logger.log(
        `Mouse button event: ${button} ${pressed ? 'pressed' : 'released'}`,
      );
      try {
        if (pressed) {
          switch (button) {
            case 'left':
              await mouse.pressButton(Button.LEFT);
              break;
            case 'right':
              await mouse.pressButton(Button.RIGHT);
              break;
            case 'middle':
              await mouse.pressButton(Button.MIDDLE);
              break;
          }
        } else {
          switch (button) {
            case 'left':
              await mouse.releaseButton(Button.LEFT);
              break;
            case 'right':
              await mouse.releaseButton(Button.RIGHT);
              break;
            case 'middle':
              await mouse.releaseButton(Button.MIDDLE);
              break;
          }
        }
        return { success: true };
      } catch (error) {
        throw new Error(
          `Failed to send mouse ${button} button ${pressed ? 'press' : 'release'} event: ${error.message}`,
        );
      }
    }
  
    /**
     * Scrolls the mouse wheel.
     *
     * @param direction The scroll direction ('up', 'down', 'left', or 'right').
     * @param amount The number of scroll steps.
     */
    async mouseWheelEvent(
      direction: 'right' | 'left' | 'up' | 'down',
      amount: number,
    ): Promise<any> {
      this.logger.log(`Mouse wheel event: ${direction} ${amount}`);
      try {
        switch (direction) {
          case 'up':
            await mouse.scrollUp(amount);
            break;
          case 'down':
            await mouse.scrollDown(amount);
            break;
          case 'left':
            await mouse.scrollLeft(amount);
            break;
          case 'right':
            await mouse.scrollRight(amount);
            break;
        }
  
        return { success: true };
      } catch (error) {
        throw new Error(`Failed to scroll: ${error.message}`);
      }
    }
  
    /**
     * Draws a mouse cursor on the screenshot at the specified position.
     *
     * @param imagePath Path to the screenshot image
     * @param cursorX X coordinate of the cursor
     * @param cursorY Y coordinate of the cursor
     */
    private async drawCursorOnImage(
      imagePath: string,
      cursorX: number,
      cursorY: number,
    ): Promise<void> {
      try {
          this.logger.debug(`Drawing cursor at (${cursorX}, ${cursorY}) on ${imagePath}`);
          this.logger.debug(`Cursor image path: ${this.cursorImagePath}`);
        // Check if cursor image exists
        try {
          await fs.access(this.cursorImagePath);
        } catch {
          this.logger.warn('Cursor image not found, skipping cursor rendering');
          return;
        }

        // Load the screenshot
        const screenshot = sharp(imagePath);
        const metadata = await screenshot.metadata();

        // Load the cursor image
        const cursor = sharp(this.cursorImagePath);
        const cursorMetadata = await cursor.metadata();
        
        if (!cursorMetadata.width || !cursorMetadata.height) {
          this.logger.warn('Failed to get cursor metadata, skipping cursor rendering');
          return;
        }

        // Calculate cursor position (offset by a few pixels to show the tip)
        const cursorOffsetX = 0;
        const cursorOffsetY = 0;

        // Check if cursor is within screenshot bounds
        if (
          cursorX < -cursorMetadata.width ||
          cursorY < -cursorMetadata.height ||
          cursorX > metadata.width ||
          cursorY > metadata.height
        ) {
          this.logger.debug('Cursor is outside screenshot bounds');
          return;
        }

        // Composite the cursor onto the screenshot
        // Use a temporary file to avoid "Cannot use same file for input and output" error
        const tempOutputPath = `${imagePath}.cursor.tmp`;
        await screenshot
          .composite([
            {
              input: this.cursorImagePath,
              left: Math.round(cursorX + cursorOffsetX),
              top: Math.round(cursorY + cursorOffsetY),
            },
          ])
          .toFile(tempOutputPath);

        // Replace the original file with the cursor-enhanced version
        await fs.rename(tempOutputPath, imagePath);

        this.logger.debug('Cursor drawn on screenshot successfully');
      } catch (error) {
        this.logger.error(`Error drawing cursor on image: ${error.message}`);
        // Don't throw error, just log it and continue without cursor
      }
    }

    /**
     * Takes a screenshot of the screen.
     *
     * @param includeCursor Whether to include the mouse cursor in the screenshot
     * @returns A Promise that resolves with a Buffer containing the image.
     */
    async screendump(includeCursor: boolean = true): Promise<Buffer> {
      const filename = `screenshot-${Date.now()}.png`;
      const filepath = path.join(this.screenshotDir, filename);
      this.logger.log(`Taking screenshot to ${filepath}${includeCursor ? ' with cursor' : ''}`);
  
      try {
        // Take screenshot
        await screen.capture(filename, FileType.PNG, this.screenshotDir);

        // If requested, draw cursor on the screenshot
        if (includeCursor) {
          const cursorPos = await mouse.getPosition();
          await this.drawCursorOnImage(filepath, cursorPos.x, cursorPos.y);
        }
  
        // Read the file back and return as buffer
        return await fs.readFile(filepath);
      } catch (error) {
        this.logger.error(`Error taking screenshot: ${error.message}`);
        throw error;
      } finally {
        // Clean up the temporary file
        try {
          await fs.unlink(filepath);
        } catch (unlinkError) {
          // Ignore if file doesn't exist
          this.logger.warn(
            `Failed to remove temporary screenshot file: ${unlinkError.message}`,
          );
        }
      }
    }
  
    async getCursorPosition(): Promise<{ x: number; y: number }> {
      this.logger.log(`Getting cursor position`);
      try {
        const position = await mouse.getPosition();
        return { x: position.x, y: position.y };
      } catch (error) {
        this.logger.error(`Error getting cursor position: ${error.message}`);
        throw error;
      }
    }
  
    /**
     * Utility method to create a delay.
     *
     * @param ms Milliseconds to wait
     */
    private async delay(ms: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
  }
