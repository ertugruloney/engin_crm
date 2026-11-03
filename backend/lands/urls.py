from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import LandViewSet
from .auth_views import (
    audit_log_summary,
    audit_logs,
    audit_logs_calendar,
    land_history,
    representative_lands,
    representative_settings,
    reserve_land,
    sales_leaderboard,
    update_representative_land_notes,
    users_view,
)
from .notification_views import (
    notification_counts,
    notification_read,
    notification_settings_view,
    notifications_list,
    notifications_read_all,
)

router = DefaultRouter()
router.register(r'lands', LandViewSet)

urlpatterns = [
    path('users/', users_view),
    path('audit-logs/', audit_logs),
    path('audit-logs/summary/', audit_log_summary),
    path('audit-logs/calendar/', audit_logs_calendar),
    path('dashboard/sales-leaderboard/', sales_leaderboard),
    path('lands/<int:land_id>/history/', land_history),
    path('notifications/', notifications_list),
    path('notifications/counts/', notification_counts),
    path('notifications/read-all/', notifications_read_all),
    path('notifications/settings/', notification_settings_view),
    path('notifications/<int:pk>/read/', notification_read),
    path('representative/lands/', representative_lands),
    path('representative/settings/', representative_settings),
    path('representative/lands/<int:land_id>/reserve/', reserve_land),
    path('representative/lands/<int:land_id>/notes/', update_representative_land_notes),
    path('', include(router.urls)),
]
