export interface AnalyticsData {
  revenue: number
  activeUsers: number
  conversionRate: number
  recentActivity: ActivityItem[]
}

export interface ActivityItem {
  id: string
  type: 'purchase' | 'signup' | 'refund'
  user: string
  amount: number
  timestamp: string
}

export interface NotificationPreferences {
  email: boolean
  push: boolean
  sms: boolean
}

export interface UserSettings {
  name: string
  email: string
  notifications: NotificationPreferences
  theme: 'light' | 'dark' | 'system'
}
