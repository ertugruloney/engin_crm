from django.http import HttpResponse
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from .audit import record_admin_action
from .auth_views import parse_date_range
from .presentation import ReportFontMissing, build_pdf, build_pptx, file_stem, period_text
from .report_summary import build_report_summary

FORMATS = {
    'pptx': ('application/vnd.openxmlformats-officedocument.presentationml.presentation', build_pptx),
    'pdf': ('application/pdf', build_pdf),
}


@api_view(['GET'])
@permission_classes([IsAdminUser])
def presentation_report(request):
    """Satış özet raporunu indirir: ?type=pptx|pdf&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&period_label=Bu Ay"""
    report_type = request.query_params.get('type', 'pptx')
    if report_type not in FORMATS:
        return Response({'detail': 'Rapor türü pptx ya da pdf olmalıdır.'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        date_from, date_to = parse_date_range(request)
    except ValueError as error:
        return Response({'detail': str(error)}, status=status.HTTP_400_BAD_REQUEST)
    period_label = request.query_params.get('period_label', '').strip()[:60]

    summary = build_report_summary(date_from, date_to, period_label)
    content_type, builder = FORMATS[report_type]
    try:
        content = builder(summary)
    except ReportFontMissing as error:
        return Response({'detail': str(error)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    record_admin_action(request, 'report.exported', 'report', '', {'type': report_type, 'period': period_text(summary)})
    response = HttpResponse(content, content_type=content_type)
    response['Content-Disposition'] = f'attachment; filename="{file_stem(summary)}.{report_type}"'
    response['Cache-Control'] = 'private, no-store'
    return response
