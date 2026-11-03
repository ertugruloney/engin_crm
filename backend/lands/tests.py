import json
from io import BytesIO
from tempfile import TemporaryDirectory

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APIClient, APITestCase
from django.contrib.auth.models import Group, User
from django.utils import timezone
from PIL import Image
from .models import AuditLog, Land, Notification, NotificationSettings, RepresentativeSettings
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
                'deleted': {'customer_phone': '05550000000', 'status': 'TAPU'},
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
                'deleted': {'customer_phone': '05550000000', 'status': 'TAPU'},
            },
        )

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
