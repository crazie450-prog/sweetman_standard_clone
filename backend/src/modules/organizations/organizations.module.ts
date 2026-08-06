import { Body, Controller, Get, Injectable, Module, Patch, Res } from '@nestjs/common'
import type { Response } from 'express'
import { ApiCookieAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator'
import { PrismaService } from '../../prisma/prisma.service'
import { requireTenant } from '../../tenancy/tenant-context'
import { Roles } from '../../common/decorators/roles.decorator'

export class UpdateOrganizationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  ownerName?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  ownerEmail?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  state?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(16)
  zipCode?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(56)
  country?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(16)
  dateFormat?: string
}

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async current() {
    const ctx = requireTenant()
    const org = await this.prisma.client.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
    })
    return {
      id: org.id,
      name: org.name,
      ownerName: org.ownerName ?? '',
      ownerEmail: org.ownerEmail,
      phone: org.phone ?? '',
      address: org.address ?? '',
      city: org.city ?? '',
      state: org.state ?? '',
      zipCode: org.zipCode ?? '',
      country: org.country,
      timezone: org.timezone,
      currency: org.currency,
      dateFormat: org.dateFormat,
      subscriptionStatus: org.subscriptionStatus,
      trialEndsAt: org.trialEndsAt?.toISOString() ?? null,
    }
  }

  async update(dto: UpdateOrganizationDto) {
    const ctx = requireTenant()
    await this.prisma.client.organization.update({
      where: { id: ctx.organizationId },
      data: dto,
    })
    return this.current()
  }

  trialDaysRemaining() {
    return this.currentTrialDays()
  }

  private async currentTrialDays(): Promise<number> {
    const ctx = requireTenant()
    const org = await this.prisma.client.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: { trialEndsAt: true, subscriptionStatus: true },
    })
    if (org.subscriptionStatus !== 'trial' || !org.trialEndsAt) return 0
    return Math.max(0, Math.ceil((org.trialEndsAt.getTime() - Date.now()) / 86400000))
  }
}

const BILLING_PLANS = [
  {
    id: 'free',
    name: 'Free',
    description: 'Perfect for trying out Nexus',
    monthlyPrice: 0,
    features: [
      '1 user',
      '50 recipes',
      '1 location',
      '100 MB storage',
      'Basic Recipes',
      'Inventory Tracking',
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    description: 'Great for small restaurants',
    monthlyPrice: 29,
    features: [
      '3 users',
      '200 recipes',
      '3 locations',
      '500 MB storage',
      'Recipe Import',
      'Basic Analytics',
      'Multi Location',
    ],
  },
  {
    id: 'professional',
    name: 'Professional',
    description: 'For growing restaurant groups',
    monthlyPrice: 79,
    features: [
      '10 users',
      'Unlimited recipes',
      '10 locations',
      '2000 MB storage',
      'Advanced Analytics',
      'Waste Tracking',
      'Priority Support',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'Unlimited everything for large chains',
    monthlyPrice: 199,
    features: [
      'Unlimited users',
      'Unlimited recipes',
      'Unlimited locations',
      '10000 MB storage',
      'All Features',
      'Dedicated Support',
    ],
  },
]

@ApiTags('organization')
@ApiCookieAuth()
@Controller('api')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Get('organizations/current')
  @ApiOperation({ summary: 'Organization profile (Settings)' })
  current() {
    return this.orgs.current()
  }

  @Patch('organizations/current')
  @Roles('admin')
  @ApiOperation({ summary: 'Save the organization settings' })
  update(@Body() dto: UpdateOrganizationDto) {
    return this.orgs.update(dto)
  }

  @Get('billing/plans')
  @ApiOperation({ summary: 'Subscription plans (static until Stripe billing in Sprint 4)' })
  plans() {
    const withCurrent = BILLING_PLANS.map((p) => ({ ...p, current: p.id === 'free' }))
    return withCurrent
  }

  @Get('billing/trial')
  @ApiOperation({ summary: 'Trial days remaining (a JSON number)' })
  async trial(@Res() res: Response) {
    res.json(await this.orgs.trialDaysRemaining())
  }
}

@Module({
  providers: [OrganizationsService],
  controllers: [OrganizationsController],
})
export class OrganizationsModule {}
