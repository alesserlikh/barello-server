export type ModerationDashboardTaskPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

export type ModerationDashboardTaskDto = {
  id: string
  type: string
  priority: ModerationDashboardTaskPriority
  title: string
  description: string
  count: number
  targetPage: string
  actionLabel: string
  sampleLabels: string[]
  updatedAt: string | null
}

export type ModerationDashboardStatsDto = {
  users: number
  venues: number
  suppliers: number
  memberships: number
  catalogCategories: number
  catalogProducts: number
  catalogSuppliers: number
}

export type ModerationDashboardResponseDto = {
  stats: ModerationDashboardStatsDto
  tasks: ModerationDashboardTaskDto[]
  generatedAt: string
}
