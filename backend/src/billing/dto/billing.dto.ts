import { ApiProperty } from '@nestjs/swagger'
import { IsIn } from 'class-validator'
import { PLAN_IDS, type PaidPlanId } from '../billing.provider'

export class CheckoutDto {
  @ApiProperty({ enum: PLAN_IDS })
  @IsIn(PLAN_IDS)
  planId!: PaidPlanId
}
