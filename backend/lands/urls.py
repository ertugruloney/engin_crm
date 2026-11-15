from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import LandViewSet
from .customer_views import CustomerViewSet
from .presentation_views import presentation_report
from .tkgm_views import tkgm_districts, tkgm_neighborhoods, tkgm_provinces
from .auth_views import (
    audit_log_summary,
    audit_logs,
    audit_logs_calendar,
    land_history,
    representative_lands,
    representative_settings,
    add_representative_land_note,
    reserve_land,
    take_land_deposit,
    sales_leaderboard,
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
router.register(r'customers', CustomerViewSet, basename='customer')

urlpatterns = [
    path('users/', users_view),
    path('audit-logs/', audit_logs),
    path('audit-logs/summary/', audit_log_summary),
    path('audit-logs/calendar/', audit_logs_calendar),
    path('dashboard/sales-leaderboard/', sales_leaderboard),
    path('reports/presentation/', presentation_report),
    path('tkgm/il/', tkgm_provinces),
    path('tkgm/il/<int:province_id>/ilce/', tkgm_districts),
    path('tkgm/ilce/<int:district_id>/mahalle/', tkgm_neighborhoods),
    path('lands/<int:land_id>/history/', land_history),
    path('notifications/', notifications_list),
    path('notifications/counts/', notification_counts),
    path('notifications/read-all/', notifications_read_all),
    path('notifications/settings/', notification_settings_view),
    path('notifications/<int:pk>/read/', notification_read),
    path('representative/lands/', representative_lands),
    path('representative/settings/', representative_settings),
    path('representative/lands/<int:land_id>/reserve/', reserve_land),
    path('representative/lands/<int:land_id>/deposit/', take_land_deposit),
    path('representative/lands/<int:land_id>/notes/', add_representative_land_note),
    path('', include(router.urls)),
]
