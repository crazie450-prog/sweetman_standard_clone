import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  type RawBodyRequest,
} from '@nestjs/common'
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { Roles } from '../common/decorators/roles.decorator'
import { Public } from '../common/decorators/public.decorator'
import { BillingService } from './billing.service'
import { CheckoutDto } from './dto/billing.dto'

@ApiTags('billing')
@ApiCookieAuth()
@Controller('api/billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('plans')
  @ApiOperation({ summary: 'Subscription plans, with the one this organization is on' })
  plans() {
    return this.billing.plans()
  }

  @Get('trial')
  @ApiOperation({ summary: 'Trial days remaining (a JSON number)' })
  async trial(@Res() res: Response) {
    res.json(await this.billing.trialDaysRemaining())
  }

  @Get('subscription')
  @ApiOperation({
    summary:
      'The subscription as the provider last reported it, and whether changes are currently refused',
  })
  subscription() {
    return this.billing.subscription()
  }

  @Post('checkout')
  @Roles('owner')
  @ApiOperation({
    summary:
      'Start a checkout for a paid plan; the answer is the URL to send the browser to. The stub provider completes it at once.',
  })
  checkout(@Body() dto: CheckoutDto) {
    return this.billing.checkout(dto.planId)
  }

  @Post('portal')
  @Roles('owner')
  @ApiOperation({
    summary:
      'Open the billing portal to change the plan, the card or cancel; needs a real provider',
  })
  portal() {
    return this.billing.portal()
  }

  @Post('webhook')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'What the payment provider reports: signed, applied once per event id, unknown types acknowledged and ignored',
  })
  webhook(@Req() req: RawBodyRequest<Request>) {
    const signature = req.headers['stripe-signature']
    return this.billing.handleWebhook(
      req.rawBody,
      Array.isArray(signature) ? signature[0] : signature,
    )
  }
}
