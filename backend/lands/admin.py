from django.contrib import admin
from .audit import record_admin_action
from .models import Notification, NotificationSettings, RepresentativeSettings
from .notifications import notify


@admin.register(RepresentativeSettings)
class RepresentativeSettingsAdmin(admin.ModelAdmin):
    fields = ['sales_representatives_can_view_reservation_details']
    list_display = ['sales_representatives_can_view_reservation_details']

    def has_add_permission(self, request):
        return not RepresentativeSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False

    def save_model(self, request, obj, form, change):
        field = 'sales_representatives_can_view_reservation_details'
        previous = RepresentativeSettings.objects.filter(pk=1).values_list(field, flat=True).first()
        super().save_model(request, obj, form, change)
        if previous is not None and previous != getattr(obj, field):
            record_admin_action(
                request,
                'settings.updated',
                'representative_settings',
                obj.pk,
                {field: {'old': previous, 'new': getattr(obj, field)}},
            )
            notify(
                'settings.updated',
                actor=request.user,
                target_type='representative_settings',
                target_id=obj.pk,
                context={
                    'old_value': 'Açık' if previous else 'Kapalı',
                    'new_value': 'Açık' if getattr(obj, field) else 'Kapalı',
                },
            )


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ['code', 'title', 'actor_username', 'related_username', 'is_read', 'created_at']
    list_filter = ['code', 'is_read']
    search_fields = ['title', 'message', 'actor_username', 'related_username']
    readonly_fields = [field.name for field in Notification._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(NotificationSettings)
class NotificationSettingsAdmin(admin.ModelAdmin):
    fields = ['disabled_codes']
    list_display = ['disabled_codes']

    def has_add_permission(self, request):
        return not NotificationSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False
