import json
from io import BytesIO
from tempfile import TemporaryDirectory

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APIClient, APITestCase
from django.contrib.auth.models import Group, User
from django.utils import timezone
from PIL import Image
from .models import AuditLog, Customer, CustomerLandRecord, Land, Notification, NotificationSettings, RepresentativeSettings
from .auth_views import VIEWER_GROUP


class LandReservationTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(
            username='admin',
            password='admin-pass-123',
            email='admin@example.com',
        )
        self.client.force_authenticate(user=self.admin)
        self.land = Land.objects.create(
            il='İstanbul',
            ilce='Silivri',
            mahalle='Çanta',
            ada='101',
            parsel='2',
        )
        self.url = f'/api/lands/{self.land.id}/change-status/'

    def test_reservation_saves_date_and_customer_details_without_expiry_date(self):
        response = self.client.patch(self.url, {
            'status': 'REZERV',
            'reservation_date': '2026-10-01',
            'customer_name': 'Ayşe Yılmaz',
            'customer_phone': '05551234567',
        }, format='json')

        self.assertEqual(response.status_code, 200)
        self.land.refresh_from_db()
        self.assertEqual(self.land.status, 'REZERV')
        self.assertEqual(self.land.reservation_date.isoformat(), '2026-10-01')
        self.assertEqual(self.land.customer_name, 'Ayşe Yılmaz')
        self.assertEqual(self.land.customer_phone, '05551234567')
        self.assertNotIn('reservation_expiry_date', response.data)
        self.assertNotIn('customer_email', response.data)
        self.assertEqual([entry['status'] for entry in response.data['status_history']], ['REZERV'])
        self.assertIsNotNone(response.data['status_history'][0]['transitioned_at'])

    def test_moving_land_back_to_available_clears_reservation_details(self):
        self.land.status = 'TAPU'
        self.land.reservation_date = '2026-10-01'
        self.land.customer_name = 'Ayşe Yılmaz'
        self.land.customer_phone = '05551234567'
        self.land.deposit_amount = '50000.00'
        self.land.save()

        response = self.client.patch(self.url, {'status': 'BOS'}, format='json')

        self.assertEqual(response.status_code, 200)
        self.land.refresh_from_db()
        self.assertEqual(self.land.status, 'BOS')
        self.assertIsNone(self.land.reservation_date)
        self.assertEqual(self.land.customer_name, '')
        self.assertEqual(self.land.customer_phone, '')
        self.assertIsNone(self.land.deposit_amount)
        self.assertEqual(
            [entry.status for entry in self.land.status_history.all()],
            ['BOS'],
        )

    def test_each_status_transition_is_recorded_automatically(self):
        response = self.client.patch(
            f'/api/lands/{self.land.id}/',
            {'status': 'KAPORA_ALINDI', 'deposit_amount': '50000.00'},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual([entry['status'] for entry in response.data['status_history']], ['KAPORA_ALINDI'])
        self.assertIsNotNone(response.data['status_history'][0]['transitioned_at'])
        self.land.refresh_from_db()
        self.assertEqual(str(self.land.deposit_amount), '50000.00')

    def test_transition_to_deposit_requires_positive_amount(self):
        for amount in (None, '0', '-1'):
            response = self.client.patch(
                self.url,
                {'status': 'KAPORA_ALINDI', 'deposit_amount': amount},
                format='json',
            )

            self.assertEqual(response.status_code, 400)
            self.assertEqual(Land.objects.get(pk=self.land.pk).status, 'BOS')

    def test_returning_from_title_deed_to_deposit_keeps_existing_deposit(self):
        self.land.status = 'TAPU'
        self.land.deposit_amount = '50000.00'
        self.land.save()

        response = self.client.patch(self.url, {'status': 'KAPORA_ALINDI'}, format='json')

        self.assertEqual(response.status_code, 200)
        self.land.refresh_from_db()
        self.assertEqual(self.land.status, 'KAPORA_ALINDI')
        self.assertEqual(str(self.land.deposit_amount), '50000.00')

    def test_transition_to_title_deed_requires_and_saves_an_image(self):
        missing_image_response = self.client.patch(
            self.url,
            {'status': 'TAPU', 'sale_price': '1250000.00'},
            format='json',
        )
        self.assertEqual(missing_image_response.status_code, 400)
        self.assertIn('title_deed_image', missing_image_response.data)

        image_buffer = BytesIO()
        Image.new('RGB', (1, 1), color='white').save(image_buffer, format='PNG')
        image_buffer.seek(0)
        image = SimpleUploadedFile('title-deed.png', image_buffer.read(), content_type='image/png')

        with TemporaryDirectory() as media_directory, override_settings(MEDIA_ROOT=media_directory):
            response = self.client.patch(
                self.url,
                {'status': 'TAPU', 'sale_price': '1250000.00', 'title_deed_image': image},
                format='multipart',
            )

            self.assertEqual(response.status_code, 200)
            self.land.refresh_from_db()
            self.assertEqual(self.land.status, 'TAPU')
            self.assertTrue(self.land.title_deed_image.name.startswith('title_deed_images/'))
            self.assertTrue(self.land.title_deed_image.storage.exists(self.land.title_deed_image.name))
            self.assertEqual(str(self.land.sale_price), '1250000.00')

    def test_transition_to_title_deed_requires_positive_sale_price(self):
        image_buffer = BytesIO()
        Image.new('RGB', (1, 1), color='white').save(image_buffer, format='PNG')
        image_buffer.seek(0)
        image = SimpleUploadedFile('title-deed.png', image_buffer.read(), content_type='image/png')

        with TemporaryDirectory() as media_directory, override_settings(MEDIA_ROOT=media_directory):
            for sale_price in (None, '0', '-1'):
                data = {'status': 'TAPU', 'title_deed_image': image}
                if sale_price is not None:
                    data['sale_price'] = sale_price
                response = self.client.patch(self.url, data, format='multipart')
                self.assertEqual(response.status_code, 400)
                self.assertIn('sale_price', response.data)
                image.seek(0)
                image = SimpleUploadedFile('title-deed.png', image.read(), content_type='image/png')

    def test_bulk_imported_title_deed_requires_sale_price(self):
        response = self.client.post('/api/lands/bulk-create/', [{
            'il': 'Ankara',
            'ilce': 'Çankaya',
            'mahalle': 'Merkez',
            'ada': '404',
            'parsel': '5',
            'status': 'TAPU',
        }], format='json')

        self.assertEqual(response.status_code, 400)
        self.assertIn('sale_price', response.data[0])

    def test_sale_price_can_be_updated_after_reaching_title_deed(self):
        self.land.status = 'TAPU'
        self.land.sale_price = '1250000.00'
        self.land.save()

        response = self.client.patch(
            self.url,
            {'status': 'TAPU', 'sale_price': '1300000.00'},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.land.refresh_from_db()
        self.assertEqual(str(self.land.sale_price), '1300000.00')

    def test_title_deed_saves_installment_plan_that_matches_sale_balance(self):
        self.land.status = 'KAPORA_ALINDI'
        self.land.deposit_amount = '200.00'
        self.land.save()
        image_buffer = BytesIO()
        Image.new('RGB', (1, 1), color='white').save(image_buffer, format='PNG')
        image = SimpleUploadedFile('title-deed.png', image_buffer.getvalue(), content_type='image/png')
        plan = [
            {'due_date': '2026-12-15', 'amount': '400.00'},
            {'due_date': '2027-01-15', 'amount': '400.00'},
        ]

        with TemporaryDirectory() as media_directory, override_settings(MEDIA_ROOT=media_directory):
            response = self.client.patch(
                self.url,
                {
                    'status': 'TAPU',
                    'sale_price': '1000.00',
                    'installment_plan': json.dumps(plan),
                    'title_deed_image': image,
                },
                format='multipart',
            )

        self.assertEqual(response.status_code, 200)
        self.land.refresh_from_db()
        self.assertEqual(self.land.installment_plan, plan)

    def test_title_deed_rejects_installment_total_that_does_not_match_balance(self):
        self.land.status = 'KAPORA_ALINDI'
        self.land.deposit_amount = '200.00'
        self.land.save()
        image_buffer = BytesIO()
        Image.new('RGB', (1, 1), color='white').save(image_buffer, format='PNG')
        image = SimpleUploadedFile('title-deed.png', image_buffer.getvalue(), content_type='image/png')

        with TemporaryDirectory() as media_directory, override_settings(MEDIA_ROOT=media_directory):
            response = self.client.patch(
                self.url,
                {
                    'status': 'TAPU',
                    'sale_price': '1000.00',
                    'installment_plan': json.dumps([
                        {'due_date': '2026-12-15', 'amount': '799.99'},
                    ]),
                    'title_deed_image': image,
                },
                format='multipart',
            )

        self.assertEqual(response.status_code, 400)
        self.assertIn('installment_plan', response.data)
        self.land.refresh_from_db()
        self.assertEqual(self.land.status, 'KAPORA_ALINDI')

    def test_installment_plan_can_be_revised_after_title_deed_stage(self):
        self.land.status = 'TAPU'
        self.land.deposit_amount = '200.00'
        self.land.sale_price = '1000.00'
        self.land.save()

        response = self.client.patch(
            self.url,
            {
                'status': 'TAPU',
                'installment_plan': [
                    {'due_date': '2026-12-20', 'amount': '400.00'},
                    {'due_date': '2027-01-20', 'amount': '400.00'},
                ],
            },
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.land.refresh_from_db()
        self.assertEqual(len(self.land.installment_plan), 2)
        self.assertEqual(self.land.installment_plan[0]['due_date'], '2026-12-20')

    def test_creating_land_records_its_initial_status_date(self):
        response = self.client.post('/api/lands/', {
            'il': 'Ankara',
            'ilce': 'Çankaya',
            'mahalle': 'Merkez',
            'ada': '202',
            'parsel': '3',
        }, format='json')

        self.assertEqual(response.status_code, 201)
        self.assertEqual([entry['status'] for entry in response.data['status_history']], ['BOS'])
        self.assertIsNotNone(response.data['status_history'][0]['transitioned_at'])
        self.assertTrue(AuditLog.objects.filter(
            actor=self.admin,
            action='land.created',
            target_id=str(response.data['id']),
        ).exists())

    def test_admin_land_deletion_is_audited(self):
        land_id = self.land.pk
        response = self.client.delete(f'/api/lands/{land_id}/')

        self.assertEqual(response.status_code, 204)
        log = AuditLog.objects.get(action='land.deleted', target_id=str(land_id))
        self.assertEqual(log.actor, self.admin)
        self.assertEqual(log.changes['deleted']['parsel'], '2')

    def test_admin_land_updates_are_audited_and_visible_to_admin_only(self):
        update_response = self.client.patch(self.url, {
            'status': 'REZERV',
            'reservation_date': '2026-10-01',
            'customer_name': 'Ayşe Yılmaz',
        }, format='json')

        self.assertEqual(update_response.status_code, 200)
        log = AuditLog.objects.get(action='land.status_changed', target_id=str(self.land.pk))
        self.assertEqual(log.actor, self.admin)
        self.assertEqual(log.changes['status'], {'old': 'BOS', 'new': 'REZERV'})
        self.assertEqual(log.changes['customer_name']['new'], 'Ayşe Yılmaz')
        self.assertEqual(
            log.changes['land_label'],
            'İstanbul, Silivri, Çanta, Ada 101 / Parsel 2',
        )

        logs_response = self.client.get('/api/audit-logs/')
        self.assertEqual(logs_response.status_code, 200)
        self.assertEqual(logs_response.data['count'], 1)
        self.assertEqual(logs_response.data['results'][0]['actor_username'], 'admin')

        viewer = User.objects.create_user(username='sales', password='Sales-pass-12345')
        viewer.groups.add(Group.objects.create(name=VIEWER_GROUP))
        self.client.force_authenticate(user=viewer)
        denied_response = self.client.get('/api/audit-logs/')
        self.assertEqual(denied_response.status_code, 403)

    def test_land_history_is_scoped_to_land_and_redacts_private_fields_for_representatives(self):
        other_land = Land.objects.create(
            il='Ankara',
            ilce='Çankaya',
            mahalle='Merkez',
            ada='202',
            parsel='3',
        )
        AuditLog.objects.create(
            actor=self.admin,
            actor_username='admin',
            action='land.status_changed',
            target_type='land',
            target_id=str(self.land.pk),
            changes={
                'status': {'old': 'BOS', 'new': 'REZERV'},
                'customer_name': {'old': '', 'new': 'Gizli Müşteri'},
                'cancel_reason': {'old': None, 'new': 'Fiyat / ödeme sorunu'},
                'cancel_detail': {'old': None, 'new': 'Kredi çıkmadı'},
                'cancel_note': {'old': None, 'new': 'Banka onay vermedi'},
                'deleted': {'customer_phone': '05550000000', 'cancel_reason': 'Gizli neden', 'status': 'TAPU'},
            },
        )
        AuditLog.objects.create(
            actor=self.admin,
            actor_username='admin',
            action='land.updated',
            target_type='land',
            target_id=str(other_land.pk),
        )

        response = self.client.get(f'/api/lands/{self.land.pk}/history/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['results']), 1)
        self.assertEqual(
            response.data['results'][0]['changes'],
            {
                'status': {'old': 'BOS', 'new': 'REZERV'},
                'customer_name': {'old': '', 'new': 'Gizli Müşteri'},
                'cancel_reason': {'old': None, 'new': 'Fiyat / ödeme sorunu'},
                'cancel_detail': {'old': None, 'new': 'Kredi çıkmadı'},
                'cancel_note': {'old': None, 'new': 'Banka onay vermedi'},
                'deleted': {'customer_phone': '05550000000', 'cancel_reason': 'Gizli neden', 'status': 'TAPU'},
            },
        )

        representative = User.objects.create_user(username='sales', password='Sales-pass-12345')
        representative.groups.add(Group.objects.create(name=VIEWER_GROUP))
        self.client.force_authenticate(user=representative)
        representative_response = self.client.get(f'/api/lands/{self.land.pk}/history/')
        representative_changes = representative_response.data['results'][0]['changes']

        self.assertNotIn('cancel_reason', representative_changes)
        self.assertNotIn('cancel_detail', representative_changes)
        self.assertNotIn('cancel_note', representative_changes)
        self.assertNotIn('cancel_reason', representative_changes['deleted'])

        viewer = User.objects.create_user(username='sales', password='Sales-pass-12345')
        viewer.groups.add(Group.objects.create(name=VIEWER_GROUP))
        self.client.force_authenticate(user=viewer)
        representative_response = self.client.get(f'/api/lands/{self.land.pk}/history/')

        self.assertEqual(representative_response.status_code, 200)
        self.assertEqual(
            representative_response.data['results'][0]['changes'],
            {
                'status': {'old': 'BOS', 'new': 'REZERV'},
                'deleted': {'status': 'TAPU'},
            },
        )

    def test_admin_login_and_logout_are_audited(self):
        client = APIClient(enforce_csrf_checks=True)
        csrf_token = client.get('/api/auth/csrf/').cookies['csrftoken'].value
        login_response = client.post(
            '/api/auth/login/',
            {'username': 'admin', 'password': 'admin-pass-123'},
            format='json',
            HTTP_X_CSRFTOKEN=csrf_token,
        )
        rotated_csrf_token = client.cookies['csrftoken'].value
        logout_response = client.post(
            '/api/auth/logout/',
            {},
            format='json',
            HTTP_X_CSRFTOKEN=rotated_csrf_token,
        )

        self.assertEqual(login_response.status_code, 200)
        self.assertEqual(logout_response.status_code, 200)
        self.assertEqual(
            list(AuditLog.objects.order_by('action').values_list('action', flat=True)),
            ['auth.login', 'auth.logout'],
        )

    def test_anonymous_users_cannot_read_lands(self):
        self.client.force_authenticate(user=None)
        response = self.client.get('/api/lands/')

        self.assertEqual(response.status_code, 403)

    def test_viewer_only_sees_available_lands_and_cannot_change_them(self):
        reserved_land = Land.objects.create(
            il='İstanbul',
            ilce='Silivri',
            mahalle='Çanta',
            ada='102',
            parsel='3',
            status='REZERV',
        )
        viewer = User.objects.create_user(username='viewer', password='viewer-pass-123')
        viewer.groups.add(Group.objects.create(name=VIEWER_GROUP))
        self.client.force_authenticate(user=viewer)

        list_response = self.client.get('/api/lands/')
        hidden_detail_response = self.client.get(f'/api/lands/{reserved_land.id}/')
        update_response = self.client.patch(
            f'/api/lands/{self.land.id}/change-status/',
            {'status': 'REZERV'},
            format='json',
        )

        self.assertEqual(list_response.status_code, 200)
        self.assertEqual([land['id'] for land in list_response.data], [self.land.id])
        self.assertEqual(hidden_detail_response.status_code, 404)
        self.assertEqual(update_response.status_code, 403)

    def test_only_staff_can_create_viewer_accounts(self):
        viewer = User.objects.create_user(username='viewer', password='viewer-pass-123')
        viewer.groups.add(Group.objects.create(name=VIEWER_GROUP))
        self.client.force_authenticate(user=viewer)
        forbidden_response = self.client.post('/api/users/', {
            'username': 'another-viewer',
            'password': 'new-viewer-pass-123',
        }, format='json')
        self.assertEqual(forbidden_response.status_code, 403)

        self.client.force_authenticate(user=self.admin)
        created_response = self.client.post('/api/users/', {
            'username': 'new-viewer',
            'password': 'new-viewer-pass-123',
        }, format='json')

        self.assertEqual(created_response.status_code, 201)
        created_user = User.objects.get(username='new-viewer')
        self.assertTrue(created_user.groups.filter(name=VIEWER_GROUP).exists())
        self.assertTrue(AuditLog.objects.filter(
            actor=self.admin,
            action='user.created',
            target_id=str(created_user.pk),
        ).exists())

    def test_sales_support_role_has_sales_representative_permissions_and_own_identity(self):
        response = self.client.post('/api/users/', {
            'username': 'sales-support',
            'password': 'new-support-pass-123',
            'role': 'sales_support',
        }, format='json')

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['role'], 'sales_support')
        support_user = User.objects.get(username='sales-support')
        self.assertTrue(support_user.groups.filter(name='Satış Destek').exists())

        self.client = APIClient()
        self.client.force_login(support_user)
        current_user_response = self.client.get('/api/auth/me/')
        lands_response = self.client.get('/api/lands/')
        reserve_response = self.client.post(
            f'/api/representative/lands/{self.land.pk}/reserve/',
            {'reservation_date': '2026-10-01', 'customer_name': 'Test Müşteri'},
            format='json',
        )
        update_response = self.client.patch(
            f'/api/lands/{self.land.pk}/change-status/',
            {'customer_phone': '05550001122', 'reservation_notes': 'Satış destek notu'},
            format='json',
        )
        bulk_response = self.client.post('/api/lands/bulk-create/', [{
            'il': 'Ankara',
            'ilce': 'Çankaya',
            'mahalle': 'Merkez',
            'ada': '303',
            'parsel': '4',
        }], format='json')
        delete_response = self.client.delete(f'/api/lands/{self.land.pk}/')

        self.assertEqual(json.loads(current_user_response.content)['role'], 'sales_support')
        self.assertEqual(lands_response.status_code, 200)
        self.assertEqual(reserve_response.status_code, 200)
        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(update_response.data['reservation_notes'], 'Satış destek notu')
        self.assertEqual(reserve_response.data['customer_name'], 'Test Müşteri')
        self.assertTrue(self.client.get('/api/representative/settings/').data['can_view_reservation_details'])
        land_history_response = self.client.get(f'/api/lands/{self.land.pk}/history/')
        self.assertEqual(land_history_response.status_code, 200)
        reservation_event = next(
            event for event in land_history_response.data['results']
            if 'customer_name' in event['changes']
        )
        self.assertEqual(reservation_event['changes']['customer_name']['new'], 'Test Müşteri')
        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(bulk_response.status_code, 201)
        self.assertEqual(delete_response.status_code, 403)
        self.assertTrue(AuditLog.objects.filter(
            actor=support_user,
            action='land.bulk_created',
        ).exists())

    def test_bulk_create_rejects_lands_that_already_exist(self):
        response = self.client.post('/api/lands/bulk-create/', [{
            'il': 'ISTANBUL',
            'ilce': 'silivri',
            'mahalle': 'Canta',
            'ada': '101',
            'parsel': '2',
        }], format='json')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['duplicate_rows'], [2])
        self.assertEqual(Land.objects.count(), 1)

    def test_bulk_create_rejects_duplicate_rows_inside_the_same_file(self):
        row = {
            'il': 'Ankara',
            'ilce': 'Çankaya',
            'mahalle': 'Merkez',
            'ada': '303',
            'parsel': '4',
        }
        response = self.client.post('/api/lands/bulk-create/', [row, {
            **row,
            'mahalle': ' merkez ',
        }], format='json')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['duplicate_rows'], [3])
        self.assertEqual(Land.objects.count(), 1)

    def test_reservation_date_defaults_to_today_when_omitted(self):
        viewer = User.objects.create_user(username='sales', password='Sales-pass-12345')
        viewer.groups.add(Group.objects.create(name=VIEWER_GROUP))
        self.client.force_authenticate(user=viewer)
        response = self.client.post(
            f'/api/representative/lands/{self.land.pk}/reserve/',
            {'customer_name': 'Tarih Alanı Olmadan', 'customer_phone': ''},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.land.refresh_from_db()
        self.assertEqual(self.land.reservation_date, timezone.localdate())

    def test_viewer_login_uses_csrf_and_opens_read_only_session(self):
        viewer = User.objects.create_user(username='session-viewer', password='Safe-viewer-password-731')
        viewer.groups.add(Group.objects.create(name=VIEWER_GROUP))
        client = APIClient(enforce_csrf_checks=True)
        csrf_response = client.get('/api/auth/csrf/')
        csrf_token = csrf_response.cookies['csrftoken'].value

        login_response = client.post(
            '/api/auth/login/',
            {'username': 'session-viewer', 'password': 'Safe-viewer-password-731'},
            format='json',
            HTTP_X_CSRFTOKEN=csrf_token,
        )
        lands_response = client.get('/api/lands/')
        write_response = client.patch(
            f'/api/lands/{self.land.id}/change-status/',
            {'status': 'REZERV'},
            format='json',
        )

        self.assertEqual(login_response.status_code, 200)
        self.assertEqual(json.loads(login_response.content)['role'], 'sales_representative')
        self.assertEqual(lands_response.status_code, 200)
        self.assertEqual(write_response.status_code, 403)

    def test_existing_viewer_group_accounts_keep_the_sales_representative_role(self):
        legacy_group = Group.objects.create(name='Boş Arsa Görüntüleyici')
        legacy_user = User.objects.create_user(username='legacy-viewer', password='Legacy-viewer-pass-731')
        legacy_user.groups.add(legacy_group)
        client = APIClient()
        client.force_login(legacy_user)
        user_response = client.get('/api/auth/me/')
        lands_response = client.get('/api/lands/')

        self.assertEqual(user_response.status_code, 200)
        self.assertEqual(json.loads(user_response.content)['role'], 'sales_representative')
        self.assertEqual(lands_response.status_code, 200)

    def test_sales_representative_can_reserve_available_land_and_see_all_lands(self):
        viewer = User.objects.create_user(username='sales', password='Sales-pass-12345')
        viewer.groups.add(Group.objects.create(name=VIEWER_GROUP))
        self.client.force_authenticate(user=viewer)
        deposit_land = Land.objects.create(
            il='Ankara',
            ilce='Çankaya',
            mahalle='Merkez',
            ada='202',
            parsel='4',
            status='KAPORA_ALINDI',
            customer_name='Elif Kaya',
        )
        title_land = Land.objects.create(
            il='İzmir',
            ilce='Urla',
            mahalle='İskele',
            ada='303',
            parsel='5',
            status='TAPU',
        )

        reserve_response = self.client.post(
            f'/api/representative/lands/{self.land.id}/reserve/',
            {
                'reservation_date': '2026-10-01',
                'customer_name': 'Ayşe Yılmaz',
                'customer_phone': '05551234567',
            },
            format='json',
        )
        list_response = self.client.get('/api/representative/lands/')

        self.assertEqual(reserve_response.status_code, 200)
        self.assertEqual(reserve_response.data['status'], 'REZERV')
        self.assertNotIn('customer_name', reserve_response.data)
        self.assertNotIn('reservation_date', reserve_response.data)
        self.assertNotIn('customer_phone', reserve_response.data)
        self.assertNotIn('reservation_notes', reserve_response.data)
        self.assertCountEqual(
            [land['id'] for land in list_response.data],
            sorted([self.land.id, deposit_land.id, title_land.id]),
        )
        reserved_result = next(land for land in list_response.data if land['id'] == self.land.id)
        self.assertNotIn('customer_email', reserved_result)
        self.assertEqual(
            {land['status'] for land in list_response.data},
            {'REZERV', 'KAPORA_ALINDI', 'TAPU'},
        )
        self.land.refresh_from_db()
        self.assertEqual(
            [entry.status for entry in self.land.status_history.all()],
            ['REZERV'],
        )
        reservation_log = AuditLog.objects.get(
            actor=viewer,
            action='land.status_changed',
            target_id=str(self.land.pk),
        )
        self.assertEqual(reservation_log.changes['status'], {'old': 'BOS', 'new': 'REZERV'})
        self.assertEqual(
            reservation_log.changes['land_label'],
            'İstanbul, Silivri, Çanta, Ada 101 / Parsel 2',
        )

    def test_representative_reservation_details_are_hidden_by_default(self):
        viewer = User.objects.create_user(username='private-sales', password='Sales-pass-12345')
        viewer.groups.add(Group.objects.create(name=VIEWER_GROUP))
        self.land.status = 'REZERV'
        self.land.reservation_date = '2026-10-01'
        self.land.customer_name = 'Gizli Müşteri'
        self.land.customer_phone = '05551234567'
        self.land.reservation_notes = 'Gizli not'
        self.land.save()
        available_land = Land.objects.create(
            il='İstanbul',
            ilce='Silivri',
            mahalle='Çanta',
            ada='999',
            parsel='9',
            reservation_date='2026-10-01',
            customer_name='Gizli Boş Arsa Müşterisi',
            customer_phone='05550000000',
            reservation_notes='Gizli boş arsa notu',
        )
        self.client.force_authenticate(user=viewer)

        settings_response = self.client.get('/api/representative/settings/')
        lands_response = self.client.get('/api/representative/lands/')
        standard_lands_response = self.client.get('/api/lands/')
        notes_response = self.client.patch(
            f'/api/representative/lands/{self.land.id}/notes/',
            {'reservation_notes': 'Yetkisiz güncelleme'},
            format='json',
        )

        self.assertEqual(settings_response.status_code, 200)
        self.assertFalse(settings_response.data['can_view_reservation_details'])
        self.assertEqual(lands_response.status_code, 200)
        self.assertEqual(standard_lands_response.status_code, 200)
        for response in (lands_response, standard_lands_response):
            land_data = next(item for item in response.data if item['id'] == available_land.pk)
            for field in ('reservation_date', 'customer_name', 'customer_phone', 'reservation_notes'):
                self.assertNotIn(field, land_data)
        self.assertEqual(notes_response.status_code, 403)
        self.land.refresh_from_db()
        self.assertEqual(self.land.reservation_notes, 'Gizli not')

    def test_admin_setting_allows_representatives_to_view_reservation_details(self):
        settings = RepresentativeSettings.objects.get(pk=1)
        settings.sales_representatives_can_view_reservation_details = True
        settings.save()
        viewer = User.objects.create_user(username='visible-sales', password='Sales-pass-12345')
        viewer.groups.add(Group.objects.create(name=VIEWER_GROUP))
        self.land.status = 'REZERV'
        self.land.reservation_date = '2026-10-01'
        self.land.customer_name = 'Görünür Müşteri'
        self.land.customer_phone = '05551234567'
        self.land.reservation_notes = 'Görünür not'
        self.land.save()
        self.client.force_authenticate(user=viewer)

        settings_response = self.client.get('/api/representative/settings/')
        lands_response = self.client.get('/api/representative/lands/')
        notes_response = self.client.patch(
            f'/api/representative/lands/{self.land.id}/notes/',
            {'reservation_notes': 'Güncel not'},
            format='json',
        )

        self.assertTrue(settings_response.data['can_view_reservation_details'])
        land_data = lands_response.data[0]
        self.assertEqual(land_data['customer_name'], 'Görünür Müşteri')
        self.assertEqual(land_data['customer_phone'], '05551234567')
        self.assertEqual(land_data['reservation_date'], '2026-10-01')
        self.assertEqual(land_data['reservation_notes'], 'Görünür not')
        self.assertEqual(notes_response.status_code, 200)
        self.assertEqual(notes_response.data['reservation_notes'], 'Güncel not')

    def test_sales_representative_cannot_reserve_with_invalid_dates_or_change_other_stages(self):
        viewer = User.objects.create_user(username='sales', password='Sales-pass-12345')
        viewer.groups.add(Group.objects.create(name=VIEWER_GROUP))
        self.client.force_authenticate(user=viewer)

        valid_reservation = self.client.post(
            f'/api/representative/lands/{self.land.id}/reserve/',
            {
                'reservation_date': '2026-10-01',
                'customer_name': 'Ayşe Yılmaz',
            },
            format='json',
        )
        self.assertEqual(valid_reservation.status_code, 200)

        unavailable_reservation = self.client.post(
            f'/api/representative/lands/{self.land.id}/reserve/',
            {
                'reservation_date': '2026-10-01',
                'customer_name': 'Ayşe Yılmaz',
            },
            format='json',
        )
        self.assertEqual(unavailable_reservation.status_code, 404)
        self.assertEqual(
            self.client.patch(
                f'/api/lands/{self.land.id}/change-status/',
                {'status': 'BOS'},
                format='json',
            ).status_code,
            403,
        )

    def test_sales_representative_can_update_notes_for_lands_at_any_stage(self):
        settings = RepresentativeSettings.objects.get(pk=1)
        settings.sales_representatives_can_view_reservation_details = True
        settings.save()
        viewer = User.objects.create_user(username='notes-sales', password='Sales-notes-pass-123')
        viewer.groups.add(Group.objects.create(name=VIEWER_GROUP))
        self.client.force_authenticate(user=viewer)
        self.land.reservation_notes = 'Eski not'
        self.land.save()

        available_response = self.client.patch(
            f'/api/representative/lands/{self.land.id}/notes/',
            {'reservation_notes': 'Yeni boş arsa notu'},
            format='json',
        )
        self.assertEqual(available_response.status_code, 200)
        self.assertEqual(available_response.data['reservation_notes'], 'Yeni boş arsa notu')

        self.land.status = 'REZERV'
        self.land.save()
        reserved_response = self.client.patch(
            f'/api/representative/lands/{self.land.id}/notes/',
            {'reservation_notes': 'Rezervli arsa notu'},
            format='json',
        )
        self.assertEqual(reserved_response.status_code, 200)
        self.assertEqual(reserved_response.data['reservation_notes'], 'Rezervli arsa notu')

        self.land.status = 'TAPU'
        self.land.save()
        title_notes_response = self.client.patch(
            f'/api/representative/lands/{self.land.id}/notes/',
            {'reservation_notes': 'Tapu aşaması notu'},
            format='json',
        )
        self.assertEqual(title_notes_response.status_code, 200)
        self.assertEqual(title_notes_response.data['reservation_notes'], 'Tapu aşaması notu')


class NotificationTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(
            username='admin',
            password='admin-pass-123',
            email='admin@example.com',
        )
        self.viewer = User.objects.create_user(username='sales', password='Sales-pass-12345')
        self.viewer.groups.add(Group.objects.create(name=VIEWER_GROUP))
        self.land = Land.objects.create(
            il='İstanbul',
            ilce='Silivri',
            mahalle='Çanta',
            ada='101',
            parsel='2',
        )
        self.client.force_authenticate(user=self.admin)

    def test_representative_reservation_creates_unread_notification_for_admin(self):
        self.client.force_authenticate(user=self.viewer)
        response = self.client.post(
            f'/api/representative/lands/{self.land.id}/reserve/',
            {
                'reservation_date': '2026-10-01',
                'customer_name': 'Ayşe Yılmaz',
                'customer_phone': '05551234567',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200)

        notification = Notification.objects.get(code='land.reserved')
        self.assertEqual(notification.related_user, self.viewer)
        self.assertEqual(notification.actor, self.viewer)
        self.assertFalse(notification.is_read)
        self.assertIn('Ayşe Yılmaz', notification.message)
        self.assertIn('Ada 101 / Parsel 2', notification.message)
        self.assertNotIn('Tarih:', notification.message)

        self.client.force_authenticate(user=self.admin)
        list_response = self.client.get('/api/notifications/')
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(list_response.data['count'], 1)
        self.assertEqual(list_response.data['results'][0]['code'], 'land.reserved')
        self.assertEqual(list_response.data['results'][0]['related_username'], 'sales')

        counts_response = self.client.get('/api/notifications/counts/')
        self.assertEqual(counts_response.data['total'], 1)
        self.assertEqual(counts_response.data['by_user'], {str(self.viewer.pk): 1})

    def test_notes_update_and_user_creation_generate_notifications(self):
        settings = RepresentativeSettings.objects.get(pk=1)
        settings.sales_representatives_can_view_reservation_details = True
        settings.save()

        self.client.force_authenticate(user=self.viewer)
        self.client.patch(
            f'/api/representative/lands/{self.land.id}/notes/',
            {'reservation_notes': 'Yeni not'},
            format='json',
        )

        self.client.force_authenticate(user=self.admin)
        self.client.post('/api/users/', {
            'username': 'new-sales',
            'password': 'New-sales-pass-123',
        }, format='json')

        codes = list(Notification.objects.order_by('id').values_list('code', flat=True))
        self.assertEqual(codes, ['land.notes_updated', 'user.created'])
        created = Notification.objects.get(code='user.created')
        self.assertEqual(created.related_user, User.objects.get(username='new-sales'))
        self.assertEqual(created.actor, self.admin)

    def test_disabled_code_does_not_create_notification(self):
        NotificationSettings.objects.create(pk=1, disabled_codes=['land.reserved'])

        self.client.force_authenticate(user=self.viewer)
        self.client.post(
            f'/api/representative/lands/{self.land.id}/reserve/',
            {'reservation_date': '2026-10-01', 'customer_name': 'Ayşe Yılmaz'},
            format='json',
        )

        self.assertFalse(Notification.objects.filter(code='land.reserved').exists())

    def test_notifications_can_be_marked_read_individually_and_in_bulk(self):
        Notification.objects.create(
            code='land.reserved',
            title='Yeni rezervasyon',
            message='Bildirim',
            actor=self.viewer,
            actor_username='sales',
            related_user=self.viewer,
            related_username='sales',
        )
        Notification.objects.create(
            code='user.login',
            title='Temsilci giriş yaptı',
            message='Bildirim',
            actor=self.viewer,
            actor_username='sales',
            related_user=self.viewer,
            related_username='sales',
        )

        read_response = self.client.post(f'/api/notifications/{Notification.objects.first().pk}/read/')
        self.assertEqual(read_response.status_code, 200)
        self.assertTrue(read_response.data['is_read'])

        counts_response = self.client.get('/api/notifications/counts/')
        self.assertEqual(counts_response.data['total'], 1)

        unread_response = self.client.get('/api/notifications/', {'unread': '1'})
        self.assertEqual(unread_response.data['count'], 1)

        bulk_response = self.client.post('/api/notifications/read-all/', {'user_id': self.viewer.pk})
        self.assertEqual(bulk_response.status_code, 200)
        self.assertEqual(bulk_response.data['updated'], 1)
        self.assertEqual(self.client.get('/api/notifications/counts/').data['total'], 0)

        missing = self.client.post('/api/notifications/99999/read/')
        self.assertEqual(missing.status_code, 404)

    def test_sales_representative_cannot_access_notifications(self):
        self.client.force_authenticate(user=self.viewer)
        self.assertEqual(self.client.get('/api/notifications/').status_code, 403)
        self.assertEqual(self.client.get('/api/notifications/counts/').status_code, 403)
        self.assertEqual(self.client.get('/api/notifications/settings/').status_code, 403)
        self.assertEqual(self.client.post('/api/notifications/read-all/').status_code, 403)

    def test_notification_settings_list_and_update_codes(self):
        settings_response = self.client.get('/api/notifications/settings/')
        self.assertEqual(settings_response.status_code, 200)
        codes = {entry['code'] for entry in settings_response.data['settings']}
        self.assertIn('land.reserved', codes)
        self.assertIn('user.login', codes)
        self.assertTrue(all(entry['enabled'] for entry in settings_response.data['settings']))

        update_response = self.client.put(
            '/api/notifications/settings/',
            {'disabled_codes': ['user.logout', 'unknown.code']},
            format='json',
        )
        self.assertEqual(update_response.status_code, 200)
        disabled = {
            entry['code']
            for entry in update_response.data['settings']
            if not entry['enabled']
        }
        self.assertEqual(disabled, {'user.logout'})
        self.assertEqual(
            list(NotificationSettings.objects.get(pk=1).disabled_codes),
            ['user.logout'],
        )
        self.assertTrue(AuditLog.objects.filter(
            actor=self.admin,
            action='notification_settings.updated',
        ).exists())

    def test_representative_session_events_are_notified(self):
        client = APIClient(enforce_csrf_checks=True)
        csrf_token = client.get('/api/auth/csrf/').cookies['csrftoken'].value
        login_response = client.post(
            '/api/auth/login/',
            {'username': 'sales', 'password': 'Sales-pass-12345'},
            format='json',
            HTTP_X_CSRFTOKEN=csrf_token,
        )
        self.assertEqual(login_response.status_code, 200)
        self.assertTrue(Notification.objects.filter(
            code='user.login',
            related_user=self.viewer,
        ).exists())

        rotated_csrf_token = client.cookies['csrftoken'].value
        logout_response = client.post(
            '/api/auth/logout/',
            {},
            format='json',
            HTTP_X_CSRFTOKEN=rotated_csrf_token,
        )
        self.assertEqual(logout_response.status_code, 200)
        self.assertTrue(Notification.objects.filter(
            code='user.logout',
            related_user=self.viewer,
        ).exists())


class AuditLogFilterTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(
            username='admin',
            password='admin-pass-123',
            email='admin@example.com',
        )
        self.viewer = User.objects.create_user(username='sales', password='Sales-pass-12345')
        self.viewer.groups.add(Group.objects.create(name=VIEWER_GROUP))
        self.land = Land.objects.create(
            il='İstanbul',
            ilce='Silivri',
            mahalle='Çanta',
            ada='101',
            parsel='2',
        )

    def test_representative_login_and_logout_are_audited(self):
        client = APIClient(enforce_csrf_checks=True)
        csrf_token = client.get('/api/auth/csrf/').cookies['csrftoken'].value
        login_response = client.post(
            '/api/auth/login/',
            {'username': 'sales', 'password': 'Sales-pass-12345'},
            format='json',
            HTTP_X_CSRFTOKEN=csrf_token,
        )
        rotated_csrf_token = client.cookies['csrftoken'].value
        logout_response = client.post(
            '/api/auth/logout/',
            {},
            format='json',
            HTTP_X_CSRFTOKEN=rotated_csrf_token,
        )

        self.assertEqual(login_response.status_code, 200)
        self.assertEqual(logout_response.status_code, 200)
        actions = list(AuditLog.objects.order_by('id').values_list('action', flat=True))
        self.assertEqual(actions, ['auth.login', 'auth.logout'])
        entry = AuditLog.objects.get(action='auth.login')
        self.assertEqual(entry.actor, self.viewer)
        self.assertEqual(entry.actor_username, 'sales')

    def test_audit_log_filters_by_actor_action_and_date(self):
        self.client.force_authenticate(user=self.admin)
        self.client.post('/api/lands/', {
            'il': 'Ankara',
            'ilce': 'Çankaya',
            'mahalle': 'Merkez',
            'ada': '202',
            'parsel': '3',
        }, format='json')

        self.client.force_authenticate(user=self.viewer)
        self.client.post(
            f'/api/representative/lands/{self.land.id}/reserve/',
            {'reservation_date': '2026-10-01', 'customer_name': 'Ayşe Yılmaz'},
            format='json',
        )

        self.client.force_authenticate(user=self.admin)
        all_response = self.client.get('/api/audit-logs/')
        self.assertEqual(all_response.status_code, 200)
        self.assertEqual(all_response.data['count'], 2)
        self.assertCountEqual(all_response.data['actors'], ['admin', 'sales'])
        self.assertCountEqual(all_response.data['actions'], ['land.created', 'land.status_changed'])

        actor_response = self.client.get('/api/audit-logs/', {'actor': 'sales'})
        self.assertEqual(actor_response.data['count'], 1)
        self.assertEqual(actor_response.data['results'][0]['actor_username'], 'sales')

        action_response = self.client.get('/api/audit-logs/', {'action': 'land.created'})
        self.assertEqual(action_response.data['count'], 1)
        self.assertEqual(action_response.data['results'][0]['actor_username'], 'admin')

        today = AuditLog.objects.first().created_at.date().isoformat()
        date_response = self.client.get('/api/audit-logs/', {'date_from': today, 'date_to': today})
        self.assertEqual(date_response.data['count'], 2)

        future = self.client.get('/api/audit-logs/', {'date_from': '2000-01-01', 'date_to': '2000-01-02'})
        self.assertEqual(future.data['count'], 0)

        invalid = self.client.get('/api/audit-logs/', {'date_from': 'not-a-date'})
        self.assertEqual(invalid.status_code, 400)

    def test_audit_log_filters_are_combined(self):
        self.client.force_authenticate(user=self.admin)
        self.client.post('/api/lands/', {
            'il': 'Ankara',
            'ilce': 'Çankaya',
            'mahalle': 'Merkez',
            'ada': '202',
            'parsel': '3',
        }, format='json')
        today = AuditLog.objects.first().created_at.date().isoformat()

        matching = self.client.get('/api/audit-logs/', {
            'actor': 'admin',
            'action': 'land.created',
            'date_from': today,
            'date_to': today,
        })
        no_match = self.client.get('/api/audit-logs/', {
            'actor': 'sales',
            'action': 'land.created',
        })

        self.assertEqual(matching.data['count'], 1)
        self.assertEqual(no_match.data['count'], 0)

    def test_audit_log_action_filter_accepts_multiple_values(self):
        self.client.force_authenticate(user=self.admin)
        self.client.post('/api/lands/', {
            'il': 'Ankara',
            'ilce': 'Çankaya',
            'mahalle': 'Merkez',
            'ada': '202',
            'parsel': '3',
        }, format='json')
        self.client.post('/api/users/', {
            'username': 'new-sales',
            'password': 'New-sales-pass-123',
        }, format='json')

        combined = self.client.get('/api/audit-logs/', {'action': 'land.created,user.created'})
        single = self.client.get('/api/audit-logs/', {'action': 'land.created'})
        no_match = self.client.get('/api/audit-logs/', {'action': 'land.deleted,land.bulk_created'})

        self.assertEqual(combined.data['count'], 2)
        self.assertEqual(single.data['count'], 1)
        self.assertEqual(no_match.data['count'], 0)

    def test_audit_calendar_only_includes_land_actions(self):
        AuditLog.objects.create(
            actor=self.admin,
            actor_username='admin',
            action='land.updated',
            target_type='land',
            target_id=str(self.land.pk),
        )
        AuditLog.objects.create(
            actor=self.admin,
            actor_username='admin',
            action='auth.login',
            target_type='session',
            target_id=str(self.admin.pk),
        )
        AuditLog.objects.create(
            actor=self.admin,
            actor_username='admin',
            action='user.created',
            target_type='sales_representative',
        )

        self.client.force_authenticate(user=self.admin)
        response = self.client.get('/api/audit-logs/calendar/')

        self.assertEqual(response.status_code, 200)
        events = [event for day in response.data['results'] for event in day['events']]
        self.assertEqual([event['action'] for event in events], ['land.updated'])

    def test_sales_leaderboard_credits_sale_to_last_reserver(self):
        sold = Land.objects.create(
            il='Ankara', ilce='Çankaya', mahalle='Merkez', ada='1', parsel='1', status='TAPU', sale_price='1500000.00',
        )
        sold.status_history.create(status='KAPORA_ALINDI')
        sold.status_history.create(status='TAPU')
        for actor in ['admin', 'sales']:
            AuditLog.objects.create(
                actor_username=actor,
                action='land.status_changed',
                target_type='land',
                target_id=str(sold.pk),
                changes={'status': {'old': 'BOS', 'new': 'REZERV'}},
            )
        AuditLog.objects.create(
            actor_username='sales',
            action='land.status_changed',
            target_type='land',
            target_id=str(self.land.pk),
            changes={'status': {'old': 'BOS', 'new': 'REZERV'}},
        )

        self.client.force_authenticate(user=self.admin)
        response = self.client.get('/api/dashboard/sales-leaderboard/')
        self.assertEqual(response.status_code, 200)
        results = {row['username']: row for row in response.data['results']}
        sales_lands = results['sales'].pop('lands')
        self.assertEqual(
            results['sales'],
            {'username': 'sales', 'reservations': 2, 'deposits': 1, 'sales': 1, 'amount': '1500000.00'},
        )
        self.assertEqual({item['land_id'] for item in sales_lands}, {sold.pk, self.land.pk})
        sold_entry = next(item for item in sales_lands if item['land_id'] == sold.pk)
        self.assertIsNotNone(sold_entry['reserved_at'])
        self.assertIsNotNone(sold_entry['deposit_at'])
        self.assertIsNotNone(sold_entry['sold_at'])
        self.assertEqual(results['admin']['sales'], 0)
        self.assertEqual([item['land_id'] for item in results['admin']['lands']], [sold.pk])
        self.assertEqual(response.data['results'][0]['username'], 'sales')

        past = self.client.get('/api/dashboard/sales-leaderboard/', {'date_to': '2000-01-01'})
        self.assertEqual(past.data['results'], [])
        self.assertEqual(self.client.get('/api/dashboard/sales-leaderboard/', {'date_from': 'oops'}).status_code, 400)

        self.client.force_authenticate(user=self.viewer)
        self.assertEqual(self.client.get('/api/dashboard/sales-leaderboard/').status_code, 403)

    def test_audit_summary_returns_counts_for_every_app_user(self):
        idle = User.objects.create_user(username='idle-sales', password='Idle-sales-pass-123')
        idle.groups.add(Group.objects.get(name=VIEWER_GROUP))
        support = User.objects.create_user(username='sales-support', password='Sales-support-pass-123')
        support.groups.add(Group.objects.create(name='Satış Destek'))

        self.client.force_authenticate(user=self.admin)
        self.client.post('/api/lands/', {
            'il': 'Ankara',
            'ilce': 'Çankaya',
            'mahalle': 'Merkez',
            'ada': '202',
            'parsel': '3',
        }, format='json')

        self.client.force_authenticate(user=self.viewer)
        self.client.post(
            f'/api/representative/lands/{self.land.id}/reserve/',
            {'reservation_date': '2026-10-01', 'customer_name': 'Ayşe Yılmaz'},
            format='json',
        )

        self.client.force_authenticate(user=self.admin)
        response = self.client.get('/api/audit-logs/summary/')
        self.assertEqual(response.status_code, 200)

        results = {row['username']: row for row in response.data['results']}
        self.assertEqual(set(results), {'admin', 'sales', 'idle-sales', 'sales-support'})
        self.assertEqual(results['admin']['total'], 1)
        self.assertEqual(results['admin']['actions'], {'land.created': 1})
        self.assertTrue(results['admin']['is_staff'])
        self.assertIsNotNone(results['admin']['last_at'])
        self.assertEqual(results['sales']['total'], 1)
        self.assertEqual(results['sales']['actions'], {'land.status_changed': 1})
        self.assertFalse(results['sales']['is_staff'])
        self.assertEqual(results['sales-support']['role'], 'sales_support')
        self.assertEqual(results['sales']['role'], 'sales_representative')
        self.assertEqual(results['idle-sales']['total'], 0)
        self.assertEqual(results['idle-sales']['actions'], {})
        self.assertIsNone(results['idle-sales']['last_at'])
        self.assertEqual(
            [row['username'] for row in response.data['results'][:2]],
            ['admin', 'sales'],
        )

        filtered = self.client.get('/api/audit-logs/summary/', {'actor': 'sales'})
        filtered_results = {row['username']: row for row in filtered.data['results']}
        self.assertEqual(filtered_results['sales']['total'], 1)
        self.assertEqual(filtered_results['admin']['total'], 0)

        invalid = self.client.get('/api/audit-logs/summary/', {'date_from': 'oops'})
        self.assertEqual(invalid.status_code, 400)

        denied = self.client.get('/api/audit-logs/summary/')
        self.client.force_authenticate(user=self.viewer)
        self.assertEqual(self.client.get('/api/audit-logs/summary/').status_code, 403)
        self.assertEqual(denied.status_code, 200)


class CustomerTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(
            username='admin',
            password='admin-pass-123',
            email='admin@example.com',
        )
        self.client.force_authenticate(user=self.admin)
        self.land = Land.objects.create(il='Ankara', ilce='Gölbaşı', mahalle='Merkez', ada='10', parsel='1')
        self.other_land = Land.objects.create(il='Ankara', ilce='Gölbaşı', mahalle='Merkez', ada='10', parsel='2')

    def reserve(self, land, name='Ayşe Yılmaz', phone='0532 111 22 33'):
        return self.client.patch(
            f'/api/lands/{land.id}/change-status/',
            {'status': 'REZERV', 'reservation_date': '2026-10-01', 'customer_name': name, 'customer_phone': phone},
            format='json',
        )

    def test_reservation_creates_customer_and_open_record(self):
        response = self.reserve(self.land)

        self.assertEqual(response.status_code, 200)
        self.land.refresh_from_db()
        customer = Customer.objects.get()
        self.assertEqual(self.land.customer, customer)
        self.assertEqual(response.data['customer'], customer.id)
        self.assertEqual(customer.full_name, 'Ayşe Yılmaz')
        self.assertEqual(customer.phone_key, '905321112233')
        record = customer.land_records.get()
        self.assertEqual((record.land, record.outcome, record.highest_status), (self.land, 'active', 'REZERV'))
        self.assertEqual(record.representative, self.admin)

    def test_same_phone_in_any_format_is_one_customer(self):
        self.reserve(self.land, phone='0532 111 22 33')
        self.reserve(self.other_land, name='Ayşe Yılmaz Kaya', phone='+90 532 111 2233')

        customer = Customer.objects.get()
        self.assertEqual(customer.land_records.count(), 2)
        self.assertEqual(set(customer.lands.values_list('id', flat=True)), {self.land.id, self.other_land.id})

    def test_releasing_land_keeps_customer_and_marks_record_cancelled(self):
        self.reserve(self.land)
        url = f'/api/lands/{self.land.id}/change-status/'
        missing_reason = self.client.patch(url, {'status': 'BOS'}, format='json')
        self.assertEqual(missing_reason.status_code, 400)
        self.assertIn('cancel_reason', missing_reason.data)
        other_without_note = self.client.patch(url, {'status': 'BOS', 'cancel_reason': 'diger'}, format='json')
        self.assertEqual(other_without_note.status_code, 400)
        self.assertIn('cancel_note', other_without_note.data)
        missing_detail = self.client.patch(url, {'status': 'BOS', 'cancel_reason': 'fiyat_odeme'}, format='json')
        self.assertEqual(missing_detail.status_code, 400)
        self.assertIn('cancel_detail', missing_detail.data)
        wrong_detail = self.client.patch(
            url, {'status': 'BOS', 'cancel_reason': 'fiyat_odeme', 'cancel_detail': 'rakipten_aldi'}, format='json',
        )
        self.assertEqual(wrong_detail.status_code, 400)
        detail_on_plain_reason = self.client.patch(
            url, {'status': 'BOS', 'cancel_reason': 'yanlis_yer', 'cancel_detail': 'imar'}, format='json',
        )
        self.assertEqual(detail_on_plain_reason.status_code, 400)

        response = self.client.patch(
            url,
            {'status': 'BOS', 'cancel_reason': 'fiyat_odeme', 'cancel_detail': 'kredi_cikmadi', 'cancel_note': ' Banka onay vermedi. '},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.assertNotIn('cancel_reason', response.data)
        self.land.refresh_from_db()
        self.assertEqual(self.land.status, 'BOS')
        self.assertIsNone(self.land.customer)
        customer = Customer.objects.get()
        record = customer.land_records.get()
        self.assertEqual(record.outcome, 'cancelled')
        self.assertEqual(
            (record.cancel_reason, record.cancel_detail, record.cancel_note),
            ('fiyat_odeme', 'kredi_cikmadi', 'Banka onay vermedi.'),
        )
        self.assertIsNotNone(record.ended_at)
        audit = AuditLog.objects.filter(action='land.status_changed', target_id=str(self.land.id)).latest('id')
        self.assertEqual(audit.changes['cancel_reason']['new'], 'Fiyat / ödeme sorunu – Kredi çıkmadı')
        self.assertEqual(audit.changes['cancel_note']['new'], 'Banka onay vermedi.')

        reasons = self.client.get('/api/customers/cancel-reasons/')
        self.assertEqual(reasons.data['total'], 1)
        self.assertEqual(reasons.data['results'], [{
            'reason': 'fiyat_odeme',
            'label': 'Fiyat / ödeme sorunu',
            'count': 1,
            'details': [{'detail': 'kredi_cikmadi', 'label': 'Kredi çıkmadı', 'count': 1}],
        }])

        listing = self.client.get('/api/customers/')
        row = listing.data[0]
        self.assertEqual((row['cancelled_count'], row['active_count'], row['purchased_count']), (1, 0, 0))
        self.assertEqual((row['last_cancel_reason'], row['last_cancel_detail']), ('fiyat_odeme', 'kredi_cikmadi'))
        self.assertEqual((row['last_il'], row['last_ilce']), ('Ankara', 'Gölbaşı'))
        detail = self.client.get(f"/api/customers/{row['id']}/")
        self.assertEqual(detail.data['records'][0]['cancel_reason'], 'fiyat_odeme')
        self.assertEqual(detail.data['records'][0]['cancel_detail'], 'kredi_cikmadi')
        self.assertEqual(detail.data['records'][0]['cancel_note'], 'Banka onay vermedi.')

    def test_title_deed_marks_purchase_and_totals_it(self):
        self.reserve(self.land)
        self.client.patch(
            f'/api/lands/{self.land.id}/change-status/',
            {'status': 'KAPORA_ALINDI', 'deposit_amount': '100000.00'},
            format='json',
        )
        image_buffer = BytesIO()
        Image.new('RGB', (1, 1), color='white').save(image_buffer, format='PNG')
        image = SimpleUploadedFile('tapu.png', image_buffer.getvalue(), content_type='image/png')
        with TemporaryDirectory() as media_directory, override_settings(MEDIA_ROOT=media_directory):
            response = self.client.patch(
                f'/api/lands/{self.land.id}/change-status/',
                {'status': 'TAPU', 'sale_price': '1500000.00', 'title_deed_image': image},
                format='multipart',
            )
        self.assertEqual(response.status_code, 200)

        record = CustomerLandRecord.objects.get()
        self.assertEqual((record.outcome, record.highest_status), ('sold', 'TAPU'))
        self.assertEqual(str(record.sale_price), '1500000.00')
        self.assertEqual(str(record.deposit_amount), '100000.00')

        detail = self.client.get(f'/api/customers/{record.customer_id}/')
        self.assertEqual(detail.data['purchased_count'], 1)
        self.assertEqual(detail.data['purchased_total'], '1500000.00')
        self.assertEqual(detail.data['records'][0]['land_status'], 'TAPU')

    def test_representative_reservation_links_customer(self):
        representative = User.objects.create_user(username='sales', password='Sales-pass-12345')
        representative.groups.add(Group.objects.create(name=VIEWER_GROUP))
        self.client.force_authenticate(user=representative)

        response = self.client.post(
            f'/api/representative/lands/{self.land.id}/reserve/',
            {'reservation_date': '2026-10-01', 'customer_name': 'Mehmet Demir', 'customer_phone': '5321234567'},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        record = CustomerLandRecord.objects.get()
        self.assertEqual((record.customer.full_name, record.customer.phone_key), ('Mehmet Demir', '905321234567'))
        self.assertEqual(record.representative, representative)
        self.assertEqual(self.client.get('/api/customers/').status_code, 403)

    def test_sales_support_can_manage_but_nobody_can_delete(self):
        support = User.objects.create_user(username='support', password='Support-pass-12345')
        support.groups.add(Group.objects.create(name='Satış Destek'))
        self.reserve(self.land)
        self.client.patch(
            f'/api/lands/{self.land.id}/change-status/',
            {'status': 'BOS', 'cancel_reason': 'fiyat_odeme', 'cancel_detail': 'kredi_cikmadi'},
            format='json',
        )
        customer = Customer.objects.get()

        self.client.force_authenticate(user=support)
        listing = self.client.get('/api/customers/')
        self.assertEqual(listing.status_code, 200)
        self.assertNotIn('last_cancel_reason', listing.data[0])
        self.assertNotIn('last_cancel_detail', listing.data[0])
        detail = self.client.get(f'/api/customers/{customer.id}/')
        self.assertNotIn('cancel_reason', detail.data['records'][0])
        self.assertNotIn('cancel_detail', detail.data['records'][0])
        self.assertNotIn('cancel_note', detail.data['records'][0])
        self.assertEqual(self.client.get('/api/customers/cancel-reasons/').status_code, 403)
        self.assertEqual(self.client.delete(f'/api/customers/{customer.id}/').status_code, 405)

    def test_editing_customer_updates_linked_lands_and_validates(self):
        self.reserve(self.land)
        customer = Customer.objects.get()
        Customer.objects.create(full_name='Başka Kişi', phone='0533 999 88 77', phone_key='905339998877')

        response = self.client.patch(
            f'/api/customers/{customer.id}/',
            {'full_name': 'Ayşe Yılmaz Kaya', 'national_id': '12345678901', 'source': 'referans'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.land.refresh_from_db()
        self.assertEqual(self.land.customer_name, 'Ayşe Yılmaz Kaya')
        self.assertTrue(AuditLog.objects.filter(action='customer.updated', target_id=str(customer.id)).exists())

        invalid_id = self.client.patch(f'/api/customers/{customer.id}/', {'national_id': '123'}, format='json')
        self.assertEqual(invalid_id.status_code, 400)
        duplicate_phone = self.client.patch(f'/api/customers/{customer.id}/', {'phone': '05339998877'}, format='json')
        self.assertEqual(duplicate_phone.status_code, 400)

    def test_changing_buyer_on_land_moves_record_to_new_customer(self):
        self.reserve(self.land)
        self.reserve(self.land, name='Can Öztürk', phone='0544 555 66 77')

        self.land.refresh_from_db()
        self.assertEqual(self.land.customer.full_name, 'Can Öztürk')
        outcomes = dict(CustomerLandRecord.objects.values_list('customer__full_name', 'outcome'))
        self.assertEqual(outcomes, {'Ayşe Yılmaz': 'cancelled', 'Can Öztürk': 'active'})
        self.assertEqual(CustomerLandRecord.objects.get(outcome='cancelled').cancel_reason, 'devredildi')

    def test_cancel_reason_is_ignored_when_not_releasing(self):
        response = self.client.patch(
            f'/api/lands/{self.land.id}/change-status/',
            {'status': 'REZERV', 'customer_name': 'Ayşe Yılmaz', 'customer_phone': '05321112233', 'cancel_reason': 'fiyat_odeme'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(CustomerLandRecord.objects.get().cancel_reason, '')


class LandLocationTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(username='admin', password='admin-pass-123', email='admin@example.com')
        self.client.force_authenticate(user=self.admin)
        self.land = Land.objects.create(il='Ankara', ilce='Gölbaşı', mahalle='Merkez', ada='10', parsel='1')
        self.url = f'/api/lands/{self.land.id}/'

    def test_saves_coordinates_and_parcel_query_link(self):
        response = self.client.patch(self.url, {
            'latitude': '39.791234',
            'longitude': '32.805678',
            'parcel_query_url': 'https://parselsorgu.tkgm.gov.tr/#ara/idari/123/10/1/1700000000000',
        }, format='json')

        self.assertEqual(response.status_code, 200)
        self.land.refresh_from_db()
        self.assertEqual((str(self.land.latitude), str(self.land.longitude)), ('39.791234', '32.805678'))
        self.assertTrue(AuditLog.objects.filter(action='land.updated', changes__has_key='latitude').exists())

        cleared = self.client.patch(self.url, {'latitude': None, 'longitude': None, 'parcel_query_url': ''}, format='json')
        self.assertEqual(cleared.status_code, 200)
        self.land.refresh_from_db()
        self.assertIsNone(self.land.latitude)

    def test_rejects_invalid_locations(self):
        only_latitude = self.client.patch(self.url, {'latitude': '39.79'}, format='json')
        self.assertEqual(only_latitude.status_code, 400)
        swapped = self.client.patch(self.url, {'latitude': '32.80', 'longitude': '39.79'}, format='json')
        self.assertEqual(swapped.status_code, 400)
        other_site = self.client.patch(self.url, {'parcel_query_url': 'https://example.com/parsel'}, format='json')
        self.assertEqual(other_site.status_code, 400)
        self.assertIn('parcel_query_url', other_site.data)

    def test_representatives_see_location_but_cannot_change_it(self):
        self.land.latitude, self.land.longitude = '39.791234', '32.805678'
        self.land.save()
        representative = User.objects.create_user(username='sales', password='Sales-pass-12345')
        representative.groups.add(Group.objects.create(name=VIEWER_GROUP))
        self.client.force_authenticate(user=representative)

        lands = self.client.get('/api/representative/lands/').data
        self.assertEqual((lands[0]['latitude'], lands[0]['longitude']), ('39.791234', '32.805678'))
        self.assertIn('parcel_query_url', lands[0])
        self.assertEqual(self.client.patch(self.url, {'latitude': '40.0', 'longitude': '33.0'}, format='json').status_code, 403)


class ParcelLinkTests(APITestCase):
    LINK = 'https://parselsorgu.tkgm.gov.tr/#ara/idari/154321/10/1/1700000000000'

    def setUp(self):
        self.admin = User.objects.create_superuser(username='admin', password='admin-pass-123', email='admin@example.com')
        self.client.force_authenticate(user=self.admin)
        self.first = Land.objects.create(il='Ankara', ilce='Gölbaşı', mahalle='Merkez', ada='10', parsel='1')
        self.neighbor = Land.objects.create(il='ANKARA', ilce='Gölbaşı', mahalle='merkez', ada='12', parsel='7')
        self.elsewhere = Land.objects.create(il='Ankara', ilce='Gölbaşı', mahalle='İncek', ada='12', parsel='7')

    def auto_links(self):
        return {row['id']: row['parcel_query_url_auto'] for row in self.client.get('/api/lands/').data}

    def test_one_saved_link_creates_links_for_the_same_neighborhood(self):
        self.assertEqual(self.auto_links()[self.neighbor.id], '')

        response = self.client.patch(f'/api/lands/{self.first.id}/', {'parcel_query_url': self.LINK}, format='json')
        self.assertEqual(response.status_code, 200)

        links = self.auto_links()
        self.assertEqual(links[self.neighbor.id], 'https://parselsorgu.tkgm.gov.tr/#ara/idari/154321/12/7/1700000000000')
        self.assertEqual(links[self.elsewhere.id], '')
        # Kendi linki olan arsaya otomatik link verilmez.
        self.assertEqual(links[self.first.id], '')

        representative = User.objects.create_user(username='sales', password='Sales-pass-12345')
        representative.groups.add(Group.objects.create(name=VIEWER_GROUP))
        self.client.force_authenticate(user=representative)
        rep_links = {row['id']: row['parcel_query_url_auto'] for row in self.client.get('/api/representative/lands/').data}
        self.assertEqual(rep_links[self.neighbor.id], links[self.neighbor.id])

    def test_link_for_another_parcel_is_not_learned(self):
        wrong = 'https://parselsorgu.tkgm.gov.tr/#ara/idari/154321/99/5/1700000000000'
        self.client.patch(f'/api/lands/{self.first.id}/', {'parcel_query_url': wrong}, format='json')
        self.assertEqual(self.auto_links()[self.neighbor.id], '')


class TkgmSyncTests(APITestCase):
    PARCEL = {
        'type': 'Feature',
        'geometry': {'type': 'Polygon', 'coordinates': [[[32.80, 39.79], [32.81, 39.79], [32.81, 39.80], [32.80, 39.80], [32.80, 39.79]]]},
        'properties': {
            'mahalleId': 55902, 'adaNo': '10', 'parselNo': '1', 'alan': '6.054,18',
            'ilAd': 'Ankara', 'ilceAd': 'Gölbaşı', 'mahalleAd': 'Merkez',
            'nitelik': 'Tarla', 'mevkii': 'Selaf', 'pafta': 'F49-C-1',
        },
    }

    def setUp(self):
        from . import tkgm
        for cached in (tkgm.provinces, tkgm.districts, tkgm.neighborhoods):
            cached.cache_clear()
        self.admin = User.objects.create_superuser(username='admin', password='admin-pass-123', email='admin@example.com')
        self.client.force_authenticate(user=self.admin)
        self.land = Land.objects.create(il='Ankara', ilce='Gölbaşı', mahalle='Merkez Mah.', ada='10', parsel='1')
        self.requests = []

    def fake_fetch(self, path):
        self.requests.append(path)
        feature = lambda text, item_id: {'properties': {'text': text, 'id': item_id}}
        if path == 'idariYapi/ilListe':
            return {'features': [feature('Adana', 23), feature('Ankara', 28)]}
        if path == 'idariYapi/ilceListe/28':
            return {'features': [feature('Altindağ', 160), feature('Gölbaşi', 170)]}
        if path == 'idariYapi/mahalleListe/170':
            return {'features': [feature('Merkez-Imar', 55901), feature('Merkez', 55902), feature('İncek', 55903)]}
        if path == 'parsel/55902/10/1':
            return self.PARCEL
        return None

    def sync(self, data=None):
        from unittest import mock
        with mock.patch('lands.tkgm.fetch_json', side_effect=self.fake_fetch):
            return self.client.post(f'/api/lands/{self.land.id}/tkgm-sync/', data or {}, format='json')

    def test_finds_parcel_and_fills_details_link_and_coordinates(self):
        response = self.sync()

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['tkgm_mahalle_id'], 55902)
        self.assertEqual(response.data['parcel_area'], '6054.18')
        self.assertEqual((response.data['parcel_quality'], response.data['parcel_locality']), ('Tarla', 'Selaf'))
        self.assertEqual(response.data['parcel_query_url_auto'], 'https://parselsorgu.tkgm.gov.tr/#ara/idari/55902/10/1/')
        self.assertEqual((response.data['latitude'], response.data['longitude']), ('39.795000', '32.805000'))
        self.assertEqual(len(response.data['parcel_geometry']), 5)
        # Önce kadastro ("Merkez"), sonra imar kaydı denenir; "Merkez Mah." / "Gölbaşi" farkları eşleşir.
        self.assertIn('parsel/55902/10/1', self.requests)
        self.assertTrue(AuditLog.objects.filter(action='land.tkgm_synced', target_id=str(self.land.id)).exists())

    def test_fixes_spelling_from_official_parcel_names_only(self):
        self.land.ilce = 'Gölbaşi'
        self.land.save()
        response = self.sync()
        self.assertEqual(response.status_code, 200)
        # "Gölbaşi" yalnızca yazım farkı olduğu için düzeltilir; "Merkez Mah." da resmi "Merkez" olur.
        self.assertEqual((response.data['ilce'], response.data['mahalle']), ('Gölbaşı', 'Merkez'))

    def test_missing_parcel_returns_neighborhood_choices_and_manual_choice_works(self):
        self.land.parsel = '2'
        self.land.save()
        response = self.sync()
        self.assertEqual(response.status_code, 404)
        self.assertIn({'id': 55903, 'name': 'İncek'}, response.data['candidates'])

        self.land.parsel = '1'
        self.land.save()
        chosen = self.sync({'mahalle_id': 55902})
        self.assertEqual(chosen.status_code, 200)
        self.assertEqual(chosen.data['tkgm_mahalle_id'], 55902)

    def test_changing_parcel_number_clears_tkgm_details(self):
        self.sync()
        response = self.client.patch(f'/api/lands/{self.land.id}/', {'parsel': '99'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data['tkgm_mahalle_id'])
        self.assertIsNone(response.data['parcel_area'])

    def test_representatives_cannot_trigger_sync(self):
        representative = User.objects.create_user(username='sales', password='Sales-pass-12345')
        representative.groups.add(Group.objects.create(name=VIEWER_GROUP))
        self.client.force_authenticate(user=representative)
        self.assertEqual(self.sync().status_code, 403)
