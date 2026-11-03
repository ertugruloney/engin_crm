from django.contrib import admin
from django.conf import settings
from django.conf.urls.static import static
from django.urls import path, include
from lands.auth_views import csrf_cookie, current_user, login_view, logout_view

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/auth/csrf/', csrf_cookie),
    path('api/auth/login/', login_view),
    path('api/auth/logout/', logout_view),
    path('api/auth/me/', current_user),
    path('api/', include('lands.urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
