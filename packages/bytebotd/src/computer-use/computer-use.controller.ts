import {
  Controller,
  Post,
  Body,
  Logger,
  HttpException,
  HttpStatus,
  Delete,
} from '@nestjs/common';
import { ComputerUseService } from './computer-use.service';
import { ComputerActionValidationPipe } from './dto/computer-action-validation.pipe';
import { ComputerActionDto } from './dto/computer-action.dto';
import { CoordinateCorrectionConfig, Coordinates } from '@bytebot/shared';

@Controller('computer-use')
export class ComputerUseController {
  private readonly logger = new Logger(ComputerUseController.name);

  constructor(private readonly computerUseService: ComputerUseService) {}

  @Post()
  async action(
    @Body(new ComputerActionValidationPipe()) params: ComputerActionDto,
  ) {
    try {
      // don't log base64 data
      const paramsCopy = { ...params };
      if (paramsCopy.action === 'write_file') {
        paramsCopy.data = 'base64 data';
      }
      this.logger.log(`Computer action request: ${JSON.stringify(paramsCopy)}`);
      return await this.computerUseService.action(params);
    } catch (error) {
      this.logger.error(
        `Error executing computer action: ${error.message}`,
        error.stack,
      );
      throw new HttpException(
        `Failed to execute computer action: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    @Post('coordinate-correction')
    setCoordinateCorrection(
      @Body() config: CoordinateCorrectionConfig,
    ) {
      try {
        this.logger.log('Setting coordinate correction config');
        this.logger.debug(
          `API Mouse Position: (${config.apiMousePosition.x}, ${config.apiMousePosition.y})`,
        );
        this.logger.debug(
          `Screenshot Mouse Position: (${config.screenshotMousePosition.x}, ${config.screenshotMousePosition.y})`,
        );
        
        this.computerUseService.setCoordinateCorrection(config);
        
        return {
          success: true,
          message: 'Coordinate correction config set successfully',
        };
      } catch (error) {
        this.logger.error(
          `Error setting coordinate correction: ${error.message}`,
          error.stack,
        );
        throw new HttpException(
          `Failed to set coordinate correction: ${error.message}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }

    @Delete('coordinate-correction')
    clearCoordinateCorrection() {
      try {
        this.logger.log('Clearing coordinate correction config');
        this.computerUseService.clearCoordinateCorrection();
        
        return {
          success: true,
          message: 'Coordinate correction config cleared successfully',
        };
      } catch (error) {
        this.logger.error(
          `Error clearing coordinate correction: ${error.message}`,
          error.stack,
        );
        throw new HttpException(
          `Failed to clear coordinate correction: ${error.message}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }

    async moveMouseWithIteration(body: {
      coordinates: Coordinates;
      maxDeviationThreshold?: number;
      maxIterations?: number;
    }) {
      try {
        const { coordinates, maxDeviationThreshold = 5, maxIterations = 10 } = body;
        
        this.logger.log(
          `Moving mouse with iteration to (${coordinates.x}, ${coordinates.y})`
        );
        this.logger.debug(
          `Max deviation: ${maxDeviationThreshold}px, Max iterations: ${maxIterations}`
        );
        
        const result = await this.computerUseService.moveMouseWithIteration(
          coordinates,
          maxDeviationThreshold,
          maxIterations
        );
        
        return {
          success: true,
          ...result,
        };
      } catch (error) {
        this.logger.error(
          `Error in iterative mouse movement: ${error.message}`,
          error.stack,
        );
        throw new HttpException(
          `Failed to move mouse with iteration: ${error.message}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }
  }
}
