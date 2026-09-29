export type ModerationSearchResultDto = {
  id: string
  type: 'SECTION' | 'MODERATOR' | 'USER' | 'VENUE' | 'SUPPLIER' | 'EMPLOYEE' | 'PRODUCT' | 'CATEGORY'
  pageId: string
  label: string
  description: string
  sectionLabel: string
  value: string
}

export type ModerationSearchResponseDto = {
  query: string
  results: ModerationSearchResultDto[]
}
