import {
  BadRequestException,
  Body,
  CallHandler,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  NestInterceptor,
  Param,
  PayloadTooLargeException,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { catchError, throwError } from 'rxjs'
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Roles } from '../../common/decorators/roles.decorator'
import type { ExtractionPayload } from './extraction'
import {
  DOC_TYPES,
  MAX_SIZE,
  tooLarge,
  type UploadedMulterFile,
  DocumentsService,
} from './documents.service'
import {
  IngredientAliasDto,
  IngredientAliasTargetDto,
  MenuItemAliasDto,
  MenuItemAliasTargetDto,
  NameMappingDto,
  ConfirmManyDto,
  FileUnitsDto,
  DocumentsQuery,
  DocumentsTypeQuery,
} from './dto/documents.dto'

@Injectable()
class FileSizeRefusal implements NestInterceptor {
  intercept(_: unknown, next: CallHandler) {
    return next
      .handle()
      .pipe(
        catchError((e: unknown) =>
          throwError(() => (e instanceof PayloadTooLargeException ? tooLarge() : e)),
        ),
      )
  }
}

@ApiTags('documents')
@ApiCookieAuth()
@Controller('api')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('documents')
  @ApiOperation({
    summary:
      'Uploaded documents and their processing status, newest first, a page at a time; type and status narrow them',
  })
  list(@Query() query: DocumentsQuery) {
    return this.documents.list(query)
  }

  @Get('documents/summary')
  @ApiOperation({
    summary: 'How many documents stand in each state, across every page; type narrows the count',
  })
  summary(@Query() query: DocumentsTypeQuery) {
    return this.documents.summary(query)
  }

  @Get('documents/ingredient-aliases')
  @Roles('manager')
  @ApiOperation({ summary: 'Extracted ingredient names and their mapping (manual corrections)' })
  aliases() {
    return this.documents.aliases()
  }

  @Post('documents/ingredient-aliases')
  @Roles('manager')
  @ApiOperation({ summary: 'Record an alternative name for an ingredient' })
  createAlias(@Body() dto: IngredientAliasDto) {
    return this.documents.createAlias(dto.rawName, dto.ingredientId)
  }

  @Post('documents/ingredient-aliases/:id')
  @Roles('manager')
  @ApiOperation({ summary: 'Map an extracted ingredient name to a known ingredient' })
  mapAlias(@Param('id') id: string, @Body() dto: IngredientAliasTargetDto) {
    return this.documents.mapAlias(id, dto.ingredientId ?? null)
  }

  @Delete('documents/ingredient-aliases/:id')
  @Roles('manager')
  @ApiOperation({ summary: 'Remove an alternative name' })
  removeAlias(@Param('id') id: string) {
    return this.documents.removeAlias(id)
  }

  @Get('documents/menu-item-aliases')
  @Roles('manager')
  @ApiOperation({ summary: 'Dish names a sales file stated and the menu items they read as' })
  menuAliases() {
    return this.documents.menuAliases()
  }

  @Post('documents/menu-item-aliases')
  @Roles('manager')
  @ApiOperation({ summary: 'Record an alternative name for a menu item' })
  createMenuAlias(@Body() dto: MenuItemAliasDto) {
    return this.documents.createMenuAlias(dto.rawName, dto.menuItemId)
  }

  @Post('documents/menu-item-aliases/:id')
  @Roles('manager')
  @ApiOperation({ summary: 'Map a dish name from a sales file to a menu item' })
  mapMenuAlias(@Param('id') id: string, @Body() dto: MenuItemAliasTargetDto) {
    return this.documents.mapMenuAlias(id, dto.menuItemId ?? null)
  }

  @Delete('documents/menu-item-aliases/:id')
  @Roles('manager')
  @ApiOperation({ summary: 'Remove an alternative dish name' })
  removeMenuAlias(@Param('id') id: string) {
    return this.documents.removeMenuAlias(id)
  }

  @Get('documents/:id')
  @ApiOperation({ summary: 'A document with its latest extracted payload for review' })
  detail(@Param('id') id: string) {
    return this.documents.detail(id)
  }

  @Post('documents')
  @Roles('staff')
  @UseInterceptors(FileSizeRefusal, FileInterceptor('file', { limits: { fileSize: MAX_SIZE } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        type: { type: 'string', enum: [...DOC_TYPES] },
      },
    },
  })
  @ApiOperation({ summary: 'Upload a document; it is queued for background extraction' })
  upload(@UploadedFile() file: UploadedMulterFile, @Body('type') type: string) {
    return this.documents.create(file, type)
  }

  @Post('documents/:id/retry')
  @Roles('staff')
  @ApiOperation({ summary: 'Re-queue a failed document' })
  retry(@Param('id') id: string) {
    return this.documents.retry(id)
  }

  @Delete('documents/:id')
  @Roles('staff')
  @ApiOperation({ summary: 'Delete a document that has not been confirmed' })
  remove(@Param('id') id: string) {
    return this.documents.remove(id)
  }

  @Post('documents/:id/map')
  @Roles('staff')
  @ApiOperation({ summary: 'Map a name on this document to one of the catalogue ingredients' })
  mapName(@Param('id') id: string, @Body() dto: NameMappingDto) {
    return this.documents.mapName(id, dto.rawName, dto.ingredientId)
  }

  @Get('documents/:id/file-units')
  @Roles('staff')
  @ApiOperation({
    summary:
      'List the ingredients of every recipe of this file still waiting whose lines are written in a unit that does not reach the unit they are counted in',
  })
  fileUnits(@Param('id') id: string) {
    return this.documents.fileUnits(id)
  }

  @Post('documents/:id/file-units')
  @Roles('manager')
  @ApiOperation({
    summary:
      'Add the new ingredients of this file in the unit chosen for them, and record the conversions its lines need',
  })
  saveFileUnits(@Param('id') id: string, @Body() dto: FileUnitsDto) {
    return this.documents.saveFileUnits(id, dto)
  }

  @Post('documents/:id/check')
  @Roles('staff')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Say what would stop the reviewed values from being confirmed, line by line, without applying them',
  })
  check(
    @Param('id') id: string,
    @Body('payload') payload?: unknown,
    @Body('createMissing') createMissing?: unknown,
  ) {
    if (createMissing !== undefined && typeof createMissing !== 'boolean') {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'createMissing must be a boolean value',
      })
    }
    return this.documents.check(id, payload, { createMissing: createMissing === true })
  }

  @Post('documents/:id/confirm')
  @Roles('staff')
  @ApiOperation({ summary: 'Apply the reviewed extraction to operational data' })
  confirm(
    @Param('id') id: string,
    @Body('payload') payload?: ExtractionPayload,
    @Body('createMissing') createMissing?: unknown,
  ) {
    if (createMissing !== undefined && typeof createMissing !== 'boolean') {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'createMissing must be a boolean value',
      })
    }
    return this.documents.confirm(id, payload, { createMissing: createMissing === true })
  }

  @Post('documents/confirm-many')
  @Roles('staff')
  @ApiOperation({
    summary:
      'Confirm several reviewed documents as extracted, and say which could not be confirmed and why',
  })
  confirmMany(@Body() dto: ConfirmManyDto) {
    if (dto.edited && !dto.ids.includes(dto.edited.id)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'edited must be one of the documents in ids',
      })
    }
    return this.documents.confirmMany(
      dto.ids,
      { createMissing: dto.createMissing === true },
      dto.edited,
    )
  }
}
