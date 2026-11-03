import json

from django.core.serializers.json import DjangoJSONEncoder
from django.db import models
from django.forms.models import model_to_dict

from .models import AuditLog


def model_snapshot(instance):
    snapshot = model_to_dict(instance)
    for field in instance._meta.fields:
        if isinstance(field, models.FileField):
            file_value = snapshot.get(field.name)
            snapshot[field.name] = file_value.name if file_value else None
    return json.loads(json.dumps(snapshot, cls=DjangoJSONEncoder))


def record_user_action(request, action, target_type, target_id='', changes=None):
    user = request.user
    if not user.is_authenticated:
        return
    AuditLog.objects.create(
        actor=user,
        actor_username=user.get_username(),
        action=action,
        target_type=target_type,
        target_id=str(target_id),
        changes=changes or {},
    )


def record_admin_action(request, action, target_type, target_id='', changes=None):
    if request.user.is_staff:
        record_user_action(request, action, target_type, target_id, changes)
