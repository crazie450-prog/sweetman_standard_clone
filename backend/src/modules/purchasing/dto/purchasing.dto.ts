import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { Quantity } from '../../../common/validation/numeric'
import { PageQuery } from '../../../common/dto/pagination.dto'
import { DAYS_MAX, DAYS_MIN, HORIZON_MAX, HORIZON_MIN } from '../../../costing/consumption'
import { DAYS_DEFAULT, HORIZON_DEFAULT } from '../purchasing.service'

export class RecommendationsQuery {
  @ApiPropertyOptional({ minimum: DAYS_MIN, maximum: DAYS_MAX, default: DAYS_DEFAULT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(DAYS_MIN)
  @Max(DAYS_MAX)
  days?: number

  @ApiPropertyOptional({ minimum: HORIZON_MIN, maximum: HORIZON_MAX, default: HORIZON_DEFAULT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(HORIZON_MIN)
  @Max(HORIZON_MAX)
  horizon?: number
}

export class DraftLineDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  ingredientId!: string

  @ApiProperty({ minimum: 0, description: '0 removes the line from a draft' })
  @Quantity()
  quantity!: number
}

export class CreateDraftDto extends RecommendationsQuery {
  @ApiProperty({ type: [DraftLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique((l: DraftLineDto) => l.ingredientId, {
    message: 'lines must name each ingredient once',
  })
  @ValidateNested({ each: true })
  @Type(() => DraftLineDto)
  lines!: DraftLineDto[]

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string
}

export class UpdateDraftDto {
  @ApiPropertyOptional({ type: [DraftLineDto] })
  @IsOptional()
  @IsArray()
  @ArrayUnique((l: DraftLineDto) => l.ingredientId, {
    message: 'lines must name each ingredient once',
  })
  @ValidateNested({ each: true })
  @Type(() => DraftLineDto)
  lines?: DraftLineDto[]

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string
}

export class DraftsQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ['draft', 'approved'], description: 'Only orders in this state' })
  @IsOptional()
  @IsIn(['draft', 'approved'])
  status?: 'draft' | 'approved'
}
