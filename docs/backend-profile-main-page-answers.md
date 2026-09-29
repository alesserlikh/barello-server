# Ответы для ТЗ backend: mobile Profile main page

Дата: 2026-06-19

Документ отвечает на вопросы из файла `Вопросы для ТЗ бэкенд.docx` и фиксирует рекомендуемые backend-решения для уточненного frontend-раздела `Profile`.

## 1. Единый источник данных для profile mobile

Решение: делаем отдельный агрегированный endpoint:

```http
GET /profile/mobile-context
```

Он нужен именно для mobile Profile main page. Desktop можно подключить позже отдельным контрактом:

```http
GET /profile/context?view=desktop
```

Source of truth для ролей и прав остается `home-context.service`. Новый `/profile/mobile-context` должен переиспользовать существующую логику `/home-context`, а не дублировать вычисление `accountType`, `accessLevel`, `displayRole`, supplier `membershipType` и `permissions.profileSections`.

`/auth/me` не считать главным источником для profile-раздела: он подходит для базовой session/user identity, но не для прав и активного business context.

## 2. Shape основного profile context

Минимальный контракт:

```ts
type ProfileMobileContextDto = {
  user: {
    id: string
    accountType: 'VENUE_OWNER' | 'VENUE_STAFF' | 'SUPPLIER_OWNER' | 'SUPPLIER_STAFF'
    fullName: string
    phone: string
    avatarUrl?: string | null
  }
  context: {
    accessLevel?: 'ADMIN' | 'SENIOR_STAFF' | 'LINE_STAFF' | null
    displayRole?: string | null
    membershipType?: 'SUPPLIER_STAFF' | null
    activeVenueId?: string | null
    activeSupplierId?: string | null
  }
  permissions: {
    profileSections: ProfileSectionPermissions
    actions: ProfileActionPermissions
  }
  navigation: {
    homeRoute: string
  }
  notifications: {
    unreadCount: number
  }
}
```

`accessLevel` и `displayRole` - разные поля:

- `accessLevel` - машинный уровень доступа, используется для permissions.
- `displayRole` - роль для отображения пользователю, но frontend все равно должен иметь право маппить code -> UI label.

Backend не должен отдавать финальные UI-тексты как единственный источник. `message`/`displayRole` могут быть fallback/debug/display hints, но frontend-тексты живут во frontend constants.

`profileSections` отдавать объектом, а не массивом:

```ts
type ProfileSectionPermissions = {
  profile: boolean
  myData: boolean
  settings: boolean
  business: boolean
  downloads: boolean
  tasks: boolean
  notes: boolean
  notifications: boolean
  employeeInvite: boolean
  supplierPrices: boolean
  promoBalance: boolean
}
```

## 3. Venue context / active venue / default venue

Главный источник active/default venue для profile main page - `/profile/mobile-context`, внутри он переиспользует существующие venue context сервисы.

Нужно отдавать:

```ts
activeVenue?: VenueProfileSummaryDto | null
venues: VenueProfileSummaryDto[]
```

Для mobile-скролла отдавать краткий summary всех заведений пользователя. Если заведений станет много, позже добавить pagination/limit, но для текущего Profile main page можно отдавать весь доступный список.

Минимальный `VenueProfileSummaryDto`:

```ts
type VenueProfileSummaryDto = {
  id: string
  name: string
  address?: string | null
  city?: string | null
  phone?: string | null
  role?: string | null
  accessLevel?: string | null
  isDefault: boolean
  isActive: boolean
  photos: ProfileMediaDto[]
  planName?: string | null
  statistics: VenueProfileStatsDto
}
```

Переключение active venue и назначение default venue остаются двумя разными действиями. В backend уже есть отдельные endpoints для active/default venue, их нужно сохранить.

Если заведение единственное, backend должен возвращать:

```ts
canUnsetDefault: false
```

Попытка снять default с единственного заведения должна возвращать стабильную ошибку, а не silently ignore:

```ts
code: 'DEFAULT_VENUE_REQUIRED'
```

Редактирование venue profile разрешено owner/admin/senior по текущей RBAC-логике. `LINE_STAFF` должен получать backend forbidden, даже если frontend скрывает CTA.

## 4. Supplier context / company card

Да, в `/profile/mobile-context` нужно отдавать supplier company summary:

```ts
activeSupplier?: SupplierCompanySummaryDto | null
```

Минимальный shape:

```ts
type SupplierCompanySummaryDto = {
  companyId: string
  companyName: string
  logoUrl?: string | null
  role?: string | null
  membershipType?: 'SUPPLIER_STAFF' | null
  phone?: string | null
  email?: string | null
  planName?: string | null
  statistics: SupplierProfileStatsDto
}
```

Для supplier permissions явно отдать action permissions:

```ts
canEditSupplierProfile: boolean
canUploadPrice: boolean
canViewPromoBalance: boolean
canManageManagers: boolean
canManageExperts: boolean
```

## 5. Статистика карточек

Backend должен отдавать готовые числа. Frontend не должен собирать статистику карточек из нескольких доменных endpoint'ов.

Для VenueCard:

```ts
type VenueProfileStatsDto = {
  menuItemsCount: number | null
  stockItemsCount: number | null
  ordersCount: number | null
  inventoriesCount: number | null
  staffCount: number | null
}
```

Для Supplier CompanyCard:

```ts
type SupplierProfileStatsDto = {
  skuCount: number | null
  activeOrdersCount: number | null
  priceListsCount: number | null
  managersCount: number | null
  expertsCount: number | null
}
```

Правило значений:

- `0` - модуль есть, записей нет.
- `null` - модуль/источник данных еще не реализован или нет доступа.
- Если нет прав на секцию, лучше скрывать секцию через permissions, а не показывать `null`.

Можно считать realtime на первом этапе. Кэширование добавить позже, если endpoint станет тяжелым.

## 6. Notifications API

Создаем публичный mounted API:

```http
GET /notifications/summary
GET /notifications
GET /notifications/:id
PATCH /notifications/:id/read
PATCH /notifications/read-all
```

Для mobile header достаточно:

```ts
{ unreadCount: number }
```

Но `/profile/mobile-context` должен включать `notifications.unreadCount`, чтобы header не делал отдельный запрос при первой загрузке.

Shape detail:

```ts
type NotificationDto = {
  id: string
  title: string
  description: string
  type: string
  isRead: boolean
  createdAt: string
  relatedEntity?: {
    type: string
    id: string
    route?: string
  } | null
}
```

При открытии detail frontend отдельно вызывает `PATCH /notifications/:id/read`. Автоматически помечать read на `GET /notifications/:id` не нужно.

Удаление уведомлений сейчас out of scope.

Обязательные error codes:

```ts
NOTIFICATION_NOT_FOUND
SECTION_FORBIDDEN
```

## 7. Tasks API

Создаем отдельный API задач, не внутри profile module:

```http
GET /tasks?period=week&date=2026-06-19
POST /tasks
PATCH /tasks/:id
PATCH /tasks/settings
GET /tasks/settings
```

Поддерживаемые `period` сейчас:

```ts
'week' | 'month'
```

`day` оставить out of scope.

Frontend должен передавать `date`, но если не передал, backend использует текущую дату сервера.

Задачи по умолчанию фильтруются по доступному user context. Фильтр по venue нужен:

```http
GET /tasks?period=week&date=2026-06-19&venueId=...
```

Shape задачи:

```ts
type TaskDto = {
  id: string
  title: string
  description?: string | null
  venueId?: string | null
  venueName?: string | null
  dueAt: string
  status: 'OPEN' | 'DONE' | 'CANCELLED'
  visibility: 'PRIVATE' | 'VENUE'
  assigneeId?: string | null
  assigneeName?: string | null
  createdById: string
  createdAt: string
  updatedAt: string
}
```

`OVERDUE` не хранить как статус, frontend/backend вычисляют его по `dueAt` и `status`.

Для календаря на mobile можно отдавать агрегаты:

```ts
days: Array<{
  date: string
  hasOpenTasks: boolean
  hasDoneTasks: boolean
}>
```

Onboarding tasks лучше создавать при регистрации/первом входе в профиль как реальные задачи. Виртуальные задачи сложнее поддерживать, потому что их нельзя нормально выполнить/скрыть.

`LINE_STAFF` не может назначать другого исполнителя. Backend обязан проверять это независимо от frontend.

Error codes:

```ts
TASK_NOT_FOUND
TASK_FORBIDDEN
TASK_ASSIGNEE_FORBIDDEN
TASK_INVALID_DUE_DATE
```

## 8. Notes API

Создаем отдельный API заметок:

```http
GET /notes/latest
GET /notes
GET /notes/:id
POST /notes
PATCH /notes/:id
PATCH /notes/:id/read
DELETE /notes/:id
```

`GET /notes/latest` возвращает последнюю доступную заметку из личных и venue-shared заметок. Onboarding/mock notes в backend не добавлять без отдельного решения.

Shape:

```ts
type NoteDto = {
  id: string
  title: string
  body?: string | null
  scope: 'PRIVATE' | 'VENUE' | 'BARELLO_TEAM'
  venueId?: string | null
  createdById: string
  createdAt: string
  updatedAt: string
  unread?: boolean
}
```

`BARELLO_TEAM` зафиксировать как внутренний share с командой Barello/support, не как публичную внешнюю ссылку.

Если заметка создана самим пользователем, для него она `read`.

При открытии заметки frontend отдельно вызывает `PATCH /notes/:id/read`.

`LINE_STAFF` может создавать `PRIVATE` notes. Создание `VENUE` notes для всех сотрудников разрешить только admin/senior, если не будет отдельного продуктового решения.

Error codes:

```ts
NOTE_NOT_FOUND
NOTE_FORBIDDEN
NOTE_INVALID_SCOPE
```

## 9. Downloads / venue uploads API

Создаем отдельный downloads API. Не использовать profile media endpoints: они предназначены для avatar/photos, а не для business uploads.

```http
GET /downloads?limit=3
GET /downloads/:id
POST /downloads
PATCH /downloads/:id
```

Для нескольких заведений по умолчанию показывать uploads активного заведения. Поддержать фильтр:

```http
GET /downloads?venueId=...&limit=3
```

Purpose enum:

```ts
'MENU' | 'STOCK' | 'SALES' | 'ANALYTICS'
```

Status enum:

```ts
'UPLOADED' | 'PROCESSING' | 'DONE' | 'FAILED'
```

Хранить:

```ts
uploadedBy
venueId
fileName
fileSize
mimeType
purpose
status
processingError
createdAt
updatedAt
```

Разрешенные расширения зафиксировать явно:

```ts
pdf, csv, xls, xlsx, txt, doc, docx
```

Размер файла: начать с 20 MB.

Purpose принимать сразу в `POST /downloads`.

Если обработка асинхронная, frontend на первом этапе использует polling/refresh при открытии страницы. Websocket/SSE out of scope.

`LINE_STAFF` должен получать:

```ts
code: 'SECTION_FORBIDDEN'
```

`permissions.profileSections.downloads` для `LINE_STAFF` должен быть `false`.

## 10. Supplier price downloads / imports

Текущие `/price-imports/preview` и `/price-imports/import` оставить для процесса импорта, но для Profile нужен отдельный status endpoint:

```http
GET /supplier/price-imports/status
GET /supplier/price-imports
GET /supplier/price-imports/:id
```

Shape для Profile:

```ts
type SupplierPriceImportStatusDto = {
  lastImport?: {
    id: string
    fileName: string
    uploadedAt: string
    status: 'UPLOADED' | 'PROCESSING' | 'DONE' | 'FAILED'
    errorsCount?: number
    warningsCount?: number
  } | null
  updatedAt?: string | null
}
```

Для UI сейчас достаточно общего status enum `UPLOADED | PROCESSING | DONE | FAILED`. Более детальные статусы `PREVIEW_READY`, `PARTIALLY_IMPORTED` можно добавить внутри detail, если потребуется.

Загружать прайс могут supplier owner/admin/senior или supplier staff с явным `canUploadPrice: true`.

Видеть статус последнего импорта могут все supplier users, если `supplierPrices: true`.

## 11. Promo balance / tariff / plan

`planName / Free Flow` сейчас лучше считать временным backend-provided display value, пока нет полноценной subscription модели.

В контракте оставить nullable поля:

```ts
plan: {
  planName: string | null
  planStatus: 'ACTIVE' | 'TRIAL' | 'PAST_DUE' | 'CANCELLED' | null
}
```

`PromoBalance` для supplier сделать read-only в рамках этого ТЗ:

```ts
promoBalance: {
  amount: number
  currency: 'RUB'
} | null
```

Endpoint пополнения promo balance сейчас out of scope.

Видеть promo balance могут supplier owner/admin/senior. Для supplier staff - только если `canViewPromoBalance: true`.

## 12. Profile completion actions

Source of truth - существующая логика profile completion, но для mobile ее нужно включить в `/profile/mobile-context`, чтобы главный экран не делал дополнительный запрос.

Shape:

```ts
type ProfileCompletionDto = {
  percent: number
  items: Array<{
    code: string
    completed: boolean
    rewardPercent: number
    title?: string
    description?: string
    action?: string
  }>
}
```

`+5`, `+15` считать процентами заполнения профиля, не баллами. Использовать `rewardPercent`, не `rewardPoints`.

Action codes:

```ts
ADD_EMAIL
VERIFY_EMAIL
ADD_EMPLOYEE
UPLOAD_AVATAR
ADD_VENUE_PHOTOS
COMPLETE_VENUE_PROFILE
```

Completion считать отдельно для venue/supplier, потому что действия и контекст отличаются.

Выполненные actions отдавать с `completed: true`, чтобы frontend мог строить прогресс и не гадать, почему action исчез.

## 13. Email verification flow

Текущие endpoints можно оставить, но в backend-ТЗ надо зафиксировать стабильный profile-facing contract:

```http
POST /profile/email-verification
GET /profile/email-verification/status
POST /profile/email-verification/confirm
```

Payload request:

```ts
{ email: string }
```

Status:

```ts
type EmailVerificationStatusDto = {
  email: string | null
  isVerified: boolean
  verifiedAt?: string | null
  expiresAt?: string | null
  canResendAt?: string | null
}
```

Email хранить как pending до подтверждения. Если пользователь меняет email до подтверждения, старая ссылка инвалидируется.

Срок действия verification link: 72 часа. Нужен resend cooldown.

Error codes:

```ts
EMAIL_INVALID
EMAIL_ALREADY_VERIFIED
EMAIL_VERIFICATION_EXPIRED
EMAIL_VERIFICATION_TOO_MANY_REQUESTS
EMAIL_VERIFICATION_NOT_FOUND
```

## 14. Employee invite / staff invitations

Выбрать TTL 48 часов и привести backend к frontend-ТЗ. Сейчас backend использует 7 дней, это надо изменить или явно поменять frontend-текст.

Рекомендуемое решение:

- TTL invite link: 48 часов.
- TTL вынести в env/config.
- Invite link одноразовый.
- Использованием ссылки считать успешное принятие приглашения/регистрацию сотрудника, а не системный share.

System share - это frontend/UI event. Backend не должен помечать invite used после share, иначе пользователь может поделиться ссылкой и потерять ее до регистрации сотрудника.

Если нужен факт share, добавить отдельное поле:

```http
PATCH /staff-invitations/:id/shared
```

Но это не должно переводить invite в used.

Payload создания:

```ts
{
  venueId: string
  role: 'SENIOR_STAFF' | 'LINE_STAFF'
  invitedName?: string
  comment?: string
}
```

Лимит 5 сотрудников backend должен enforce'ить. В лимит включать принятых сотрудников и pending invites, чтобы нельзя было обойти ограничение.

Создавать invite могут owner/admin/senior, если это соответствует RBAC. `LINE_STAFF` получает forbidden.

Error codes:

```ts
INVITE_FORBIDDEN
INVITE_LIMIT_REACHED
INVITE_INVALID_ROLE
INVITE_EXPIRED
INVITE_ALREADY_USED
```

## 15. Line Staff photo moderation

В рамках текущего backend-ТЗ зафиксировать как out of scope.

Пока workflow moderation не реализован, backend должен запрещать `LINE_STAFF` upload venue photos:

```ts
code: 'SECTION_FORBIDDEN'
```

Будущий workflow:

```http
POST /venue/photo-suggestions
GET /venue/photo-suggestions
PATCH /venue/photo-suggestions/:id/approve
PATCH /venue/photo-suggestions/:id/reject
```

Approve/reject: owner/admin/senior.

## 16. Permissions и profileSections

Да, расширяем permissions:

```ts
profileSections: {
  profile: boolean
  myData: boolean
  settings: boolean
  business: boolean
  downloads: boolean
  tasks: boolean
  notes: boolean
  notifications: boolean
  employeeInvite: boolean
  supplierPrices: boolean
  promoBalance: boolean
}
```

Нужны отдельные action permissions:

```ts
actions: {
  canEditProfile: boolean
  canUploadAvatar: boolean
  canInviteEmployees: boolean
  canAddVenue: boolean
  canEditVenue: boolean
  canUploadVenuePhotos: boolean
  canCreateTask: boolean
  canAssignTask: boolean
  canCreateSharedTask: boolean
  canCreateNote: boolean
  canCreateSharedNote: boolean
  canUploadDownloads: boolean
  canUploadPrice: boolean
  canViewPromoBalance: boolean
}
```

`profileSections` отвечает за видимость разделов. `actions` отвечает за кнопки/операции внутри разделов.

Permissions отдавать в context. В отдельных endpoints backend все равно обязан делать permission checks, но не обязан каждый раз возвращать permissions.

Если permissions изменились во время сессии, frontend узнает это при обновлении `/profile/mobile-context` или `/home-context`.

## 17. Нормализация ошибок Profile API

Да, profile-related endpoints нужно привести к единому формату:

```ts
{
  error: {
    code: string
    message: string
    details?: unknown
  }
}
```

`message` - fallback/debug. UI показывает тексты из frontend `ui-profile.ts` по `error.code`.

Обязательные codes:

```ts
PROFILE_FORBIDDEN
SECTION_FORBIDDEN
FILE_UPLOAD_INVALID_TYPE
FILE_UPLOAD_TOO_LARGE
NOTIFICATION_NOT_FOUND
TASK_NOT_FOUND
NOTE_NOT_FOUND
VENUE_NOT_FOUND
SUPPLIER_NOT_FOUND
EMAIL_INVALID
INVITE_LIMIT_REACHED
```

## 18. Logout

`/auth/logout` уже есть. В backend-ТЗ нужно зафиксировать, что frontend вызывает его при logout, а затем чистит local session.

Logout должен revoke'ать текущую server session/refresh token. Не все user sessions.

Response:

```ts
{ ok: true }
```

Если backend logout упал, frontend все равно должен чистить local session, но может отправить telemetry/debug событие.

## 19. API aggregation и производительность

`/profile/mobile-context` должен включать сразу:

- user;
- context/permissions;
- profile completion;
- active venue/company;
- venue/company stats;
- notifications summary;
- tasks summary for current week;
- latest note;
- latest downloads or supplier price status;
- promo balance for supplier, if allowed.

Тяжелые списки грузить lazy:

- full notifications list;
- full tasks list beyond summary;
- full notes list;
- full downloads list;
- price import details.

Если один дочерний блок упал, endpoint не должен падать целиком, если базовый profile/context загружен. Возвращать partial response:

```ts
{
  profile: {...},
  tasks: null,
  errorsBySection: {
    tasks: { code: 'TASKS_UNAVAILABLE' }
  }
}
```

Критическая ошибка только если не удалось определить user/context/permissions.

Добавить лимиты:

- venues summary: все текущие, но позже pagination при необходимости;
- latest downloads: 3;
- latest tasks summary: текущая неделя;
- latest note: 1;
- notifications summary: только count.

## 20. Out of scope

В текущем backend-ТЗ зафиксировать как out of scope:

- полноценный блок "Обучение" для `LINE_STAFF`;
- распознавание фото/сканов в структурированные данные;
- photo moderation workflow;
- websocket/SSE для live statuses;
- сложная notification center логика beyond summary/list/detail/read;
- сложная аналитика загруженных файлов;
- реальная монетизация/paywall;
- endpoint пополнения promo balance;
- удаление уведомлений.

При этом в scope текущего backend-ТЗ входят:

- `/profile/mobile-context`;
- расширенные permissions;
- notifications summary/list/detail/read;
- tasks API;
- notes API;
- downloads API;
- supplier price status;
- profile completion block;
- email verification contract;
- invite TTL decision;
- нормализация profile error codes.

