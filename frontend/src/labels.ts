export const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Oturum açıldı',
  'auth.logout': 'Oturum kapatıldı',
  'land.created': 'Arsa oluşturuldu',
  'land.updated': 'Arsa güncellendi',
  'land.status_changed': 'Arsa durumu değiştirildi',
  'land.deleted': 'Arsa silindi',
  'land.bulk_created': 'Toplu arsa ekleme',
  'user.created': 'Kullanıcı oluşturuldu',
  'notification_settings.updated': 'Bildirim ayarları güncellendi',
  'settings.updated': 'Temsilci ayarı güncellendi',
};

export const TARGET_LABELS: Record<string, string> = {
  land: 'Arsa',
  session: 'Oturum',
  sales_representative: 'Satış temsilcisi',
  sales_support: 'Satış destek',
  representative_settings: 'Temsilci ayarları',
  notification_settings: 'Bildirim ayarları',
};
