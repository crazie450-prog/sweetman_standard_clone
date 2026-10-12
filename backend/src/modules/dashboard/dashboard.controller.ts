import { Controller, Get, Query } from '@nestjs/common'
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { DashboardService } from './dashboard.service'

@ApiTags('dashboard')
@ApiCookieAuth()
@Controller('api')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('dashboard/kpis')
  @ApiOperation({ summary: 'Dashboard KPI tiles' })
  kpis() {
    return this.dashboard.kpis()
  }

  @Get('dashboard/trends')
  @ApiOperation({ summary: 'Seven-day sparkline series' })
  trends() {
    return this.dashboard.trends()
  }

  @Get('dashboard/activity')
  @ApiOperation({ summary: 'Recent activity: waste, production, recipes and team' })
  activity() {
    return this.dashboard.activity()
  }

  @Get('analytics/spend')
  @ApiOperation({ summary: 'Purchase spend by ingredient category, last 30 days' })
  spend() {
    return this.dashboard.spendByCategory()
  }

  @Get('analytics/cost-by-category')
  @ApiOperation({ summary: 'Cost of the dishes sold, split by the category of the dish' })
  costByCategory() {
    return this.dashboard.costByCategory()
  }

  @Get('analytics/waste-breakdown')
  @ApiQuery({ name: 'from', required: false, description: 'ISO date (inclusive)' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO date (inclusive)' })
  @ApiOperation({ summary: 'Waste value grouped by reason for a period' })
  wasteBreakdown(@Query('from') from?: string, @Query('to') to?: string) {
    return this.dashboard.wasteBreakdown(from, to)
  }

  @Get('analytics/revenue-trend')
  @ApiOperation({ summary: 'Daily revenue and cost, last 30 days' })
  revenueTrend() {
    return this.dashboard.revenueTrend()
  }

  @Get('analytics/food-cost-variance')
  @ApiQuery({ name: 'from', required: false, description: 'ISO date (inclusive)' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO date (inclusive)' })
  @ApiOperation({ summary: 'Standard vs actual food cost and variance by category' })
  foodCostVariance(@Query('from') from?: string, @Query('to') to?: string) {
    return this.dashboard.foodCostVariance(from, to)
  }
}
