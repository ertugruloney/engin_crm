from django.db.models import Count, Max, OuterRef, Q, Subquery, Sum
from django.db.models.functions import Coalesce, Greatest
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import BasePermission, IsAdminUser

from .audit import record_admin_action, record_user_action
from .auth_views import is_sales_support
from .models import CANCEL_REASON_TREE, Customer, CustomerLandRecord
from .serializers import CustomerDetailSerializer, CustomerSerializer


class CustomerPermission(BasePermission):
    """Müşteri kartlarını yönetici ve satış destek görür/düzenler; temsilciler göremez."""

    def has_permission(self, request, view):
        user = request.user
        return user.is_authenticated and (user.is_staff or is_sales_support(user))


class CustomerViewSet(viewsets.ModelViewSet):
    permission_classes = [CustomerPermission]
    # Geçmişin kaybolmaması için müşteri silinemez.
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_queryset(self):
        latest = CustomerLandRecord.objects.filter(customer=OuterRef('pk')).order_by('-started_at', '-id')
        last_started = Max('land_records__started_at')
        return (
            Customer.objects.annotate(
                purchased_count=Count('land_records', filter=Q(land_records__outcome='sold'), distinct=True),
                purchased_total=Sum('land_records__sale_price', filter=Q(land_records__outcome='sold')),
                active_count=Count('land_records', filter=Q(land_records__outcome='active'), distinct=True),
                cancelled_count=Count('land_records', filter=Q(land_records__outcome='cancelled'), distinct=True),
                last_activity_at=Greatest(last_started, Coalesce(Max('land_records__ended_at'), last_started)),
                last_il=Subquery(latest.values('il')[:1]),
                last_ilce=Subquery(latest.values('ilce')[:1]),
                last_cancel_reason=Subquery(latest.filter(outcome='cancelled').values('cancel_reason')[:1]),
                last_cancel_detail=Subquery(latest.filter(outcome='cancelled').values('cancel_detail')[:1]),
            )
            .prefetch_related('land_records__land', 'land_records__representative')
            .order_by('full_name', 'id')
        )

    @action(detail=False, methods=['get'], url_path='cancel-reasons', permission_classes=[IsAdminUser])
    def cancel_reasons(self, request):
        """İptal edilen müşteri-arsa kayıtlarının ana ve alt nedenlere göre dağılımı (çoktan aza)."""
        counts = {}
        for reason, detail, count in (
            CustomerLandRecord.objects.filter(outcome='cancelled')
            .values_list('cancel_reason', 'cancel_detail')
            .annotate(count=Count('id'))
        ):
            counts.setdefault(reason, {})[detail] = count
        rows = []
        for code, label, details in [*CANCEL_REASON_TREE, ('', 'Belirtilmemiş', [])]:
            by_detail = counts.get(code, {})
            if not by_detail:
                continue
            detail_rows = [
                {'detail': detail, 'label': detail_label, 'count': by_detail[detail]}
                for detail, detail_label in details
                if by_detail.get(detail)
            ]
            if by_detail.get('') and details:
                detail_rows.append({'detail': '', 'label': 'Alt seçim yok', 'count': by_detail['']})
            detail_rows.sort(key=lambda row: -row['count'])
            rows.append({'reason': code, 'label': label, 'count': sum(by_detail.values()), 'details': detail_rows})
        rows.sort(key=lambda row: -row['count'])
        return Response({'total': sum(row['count'] for row in rows), 'results': rows})

    def get_serializer_class(self):
        return CustomerDetailSerializer if self.action == 'retrieve' else CustomerSerializer

    def _record(self, action, customer, changes):
        record = record_admin_action if self.request.user.is_staff else record_user_action
        record(self.request, action, 'customer', customer.pk, {'customer_label': customer.full_name, **changes})

    def perform_create(self, serializer):
        customer = serializer.save()
        self._record('customer.created', customer, {})

    def perform_update(self, serializer):
        fields = ['full_name', 'phone', 'national_id', 'source', 'notes']
        previous = {field: getattr(serializer.instance, field) for field in fields}
        customer = serializer.save()
        changes = {
            field: {'old': previous[field], 'new': getattr(customer, field)}
            for field in fields
            if previous[field] != getattr(customer, field)
        }
        if changes:
            self._record('customer.updated', customer, changes)
