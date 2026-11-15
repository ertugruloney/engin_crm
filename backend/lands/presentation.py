"""Satış özet raporunu PowerPoint (.pptx) ve PDF olarak üretir.

Veri lands.report_summary.build_report_summary'den gelir; iki biçim de aynı bölümleri içerir:
kapak, genel bakış, bölgeler, iller, müstakil/hisseli, hisseli parseller, satış temsilcileri, iptal nedenleri.
"""
import os
from decimal import Decimal
from io import BytesIO

from django.conf import settings

# Renkler (uygulamadaki rapor sayfasıyla uyumlu).
NAVY = '13254F'
BLUE = '1D4ED8'
SKY = '0EA5E9'
VIOLET = '7C3AED'
EMERALD = '10B981'
AMBER = 'F59E0B'
SLATE = '64748B'
LIGHT = 'F1F5F9'
STATUS_COLORS = {'TAPU': EMERALD, 'KAPORA_ALINDI': BLUE, 'REZERV': AMBER, 'BOS': '94A3B8'}


# ---------------------------------------------------------------------------
# Biçimlendirme
# ---------------------------------------------------------------------------

def money(amount):
    """1234567 -> "1.234.567 TL" (₺ işareti her yazı tipinde bulunmadığı için TL yazılır)."""
    return f'{int(Decimal(amount or 0)):,} TL'.replace(',', '.')


def short_money(amount):
    """Büyük tutarlar için okunaklı yazım: "45,2 milyon TL"."""
    amount = Decimal(amount or 0)
    for limit, unit in ((Decimal(1_000_000_000), 'milyar'), (Decimal(1_000_000), 'milyon'), (Decimal(1_000), 'bin')):
        if amount >= limit:
            value = f'{amount / limit:.1f}'.rstrip('0').rstrip('.').replace('.', ',')
            return f'{value} {unit} TL'
    return money(amount)


def date_text(value):
    return value.strftime('%d.%m.%Y') if value else ''


def period_text(summary):
    start, end = summary['date_from'], summary['date_to']
    if start or end:
        return f"{summary['period_label']} ({date_text(start) or 'başlangıç'} – {date_text(end) or 'bugün'})"
    return summary['period_label']


def file_stem(summary):
    return f"satis-raporu-{summary['generated_at']:%Y-%m-%d}"


# ---------------------------------------------------------------------------
# PowerPoint
# ---------------------------------------------------------------------------

def build_pptx(summary):
    from pptx import Presentation
    from pptx.chart.data import CategoryChartData
    from pptx.dml.color import RGBColor
    from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.enum.text import PP_ALIGN
    from pptx.util import Inches, Pt

    rgb = RGBColor.from_string
    font_name = 'Arial'  # Tema yazı tipi her cihazda bulunmadığı için açıkça verilir.
    presentation = Presentation()
    presentation.slide_width, presentation.slide_height = Inches(13.333), Inches(7.5)
    blank = presentation.slide_layouts[6]
    period = period_text(summary)
    page = {'number': 0}

    def text_box(slide, left, top, width, height, text, size=14, bold=False, color=NAVY, align=None):
        box = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))
        frame = box.text_frame
        frame.word_wrap = True
        lines = text if isinstance(text, list) else [text]
        for index, line in enumerate(lines):
            paragraph = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
            paragraph.text = line
            paragraph.font.name = font_name
            paragraph.font.size = Pt(size)
            paragraph.font.bold = bold
            paragraph.font.color.rgb = rgb(color)
            if align:
                paragraph.alignment = align
        return box

    def new_slide(title, subtitle=''):
        page['number'] += 1
        slide = presentation.slides.add_slide(blank)
        band = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, presentation.slide_width, Inches(1.05))
        band.fill.solid()
        band.fill.fore_color.rgb = rgb(NAVY)
        band.line.fill.background()
        text_box(slide, 0.5, 0.18, 9.5, 0.6, title, size=26, bold=True, color='FFFFFF')
        if subtitle:
            text_box(slide, 0.5, 0.62, 9.5, 0.4, subtitle, size=12, color='BFDBFE')
        text_box(slide, 9.3, 0.36, 3.6, 0.4, period, size=11, color='BFDBFE', align=PP_ALIGN.RIGHT)
        text_box(slide, 11.8, 7.0, 1.1, 0.3, str(page['number']), size=10, color=SLATE, align=PP_ALIGN.RIGHT)
        return slide

    def tile(slide, left, top, width, label, value, hint, color):
        shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(left), Inches(top), Inches(width), Inches(1.45))
        shape.adjustments[0] = 0.08
        shape.fill.solid()
        shape.fill.fore_color.rgb = rgb('FFFFFF')
        shape.line.color.rgb = rgb('E2E8F0')
        accent = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(left), Inches(top + 0.15), Inches(0.08), Inches(1.15))
        accent.fill.solid()
        accent.fill.fore_color.rgb = rgb(color)
        accent.line.fill.background()
        text_box(slide, left + 0.25, top + 0.1, width - 0.35, 0.35, label, size=12, color=SLATE)
        # Uzun değerler (ör. "194,8 milyon TL") kutuya sığsın diye küçültülür.
        value = str(value)
        text_box(slide, left + 0.25, top + 0.42, width - 0.35, 0.55, value, size=24 if len(value) <= 9 else 19, bold=True)
        text_box(slide, left + 0.25, top + 0.95, width - 0.35, 0.35, hint, size=10, color='94A3B8')

    def table(slide, left, top, width, headers, rows, col_widths=None, font_size=11, text_cols=1):
        if not rows:
            text_box(slide, left, top, width, 0.5, 'Bu dönemde gösterilecek kayıt yok.', size=13, color=SLATE)
            return
        shape = slide.shapes.add_table(len(rows) + 1, len(headers), Inches(left), Inches(top), Inches(width), Inches(0.38 * (len(rows) + 1)))
        grid = shape.table
        if col_widths:
            total = sum(col_widths)
            for index, part in enumerate(col_widths):
                grid.columns[index].width = Inches(width * part / total)
        for row_index, values in enumerate([headers, *rows]):
            for col_index, value in enumerate(values):
                cell = grid.cell(row_index, col_index)
                cell.text = str(value)
                paragraph = cell.text_frame.paragraphs[0]
                paragraph.font.name = font_name
                paragraph.font.size = Pt(font_size)
                # İlk text_cols sütun metindir (sola), kalanlar sayıdır (sağa).
                paragraph.alignment = PP_ALIGN.LEFT if col_index < text_cols else PP_ALIGN.RIGHT
                cell.fill.solid()
                if row_index == 0:
                    cell.fill.fore_color.rgb = rgb(NAVY)
                    paragraph.font.bold = True
                    paragraph.font.color.rgb = rgb('FFFFFF')
                else:
                    cell.fill.fore_color.rgb = rgb(LIGHT if row_index % 2 == 0 else 'FFFFFF')
                    paragraph.font.color.rgb = rgb('1E293B')

    def bar_chart(slide, left, top, width, height, categories, series, horizontal=True, money_axis=False, legend=False):
        # Yatay grafikte ilk kategori en üstte görünsün diye veri ters sırada verilir
        # (eksen ters çevirme bazı görüntüleyicilerde desteklenmediği için).
        order = list(reversed(range(len(categories)))) if horizontal else list(range(len(categories)))
        data = CategoryChartData()
        data.categories = [categories[index] for index in order]
        for name, values, _ in series:
            data.add_series(name, [float(values[index]) for index in order])
        chart_type = XL_CHART_TYPE.BAR_CLUSTERED if horizontal else XL_CHART_TYPE.COLUMN_CLUSTERED
        chart = slide.shapes.add_chart(chart_type, Inches(left), Inches(top), Inches(width), Inches(height), data).chart
        chart.has_legend = legend
        if legend:
            chart.legend.position = XL_LEGEND_POSITION.BOTTOM
            chart.legend.include_in_layout = False
            chart.legend.font.size = Pt(11)
        chart.font.size = Pt(11)
        chart.font.name = font_name
        value_axis = chart.value_axis
        value_axis.has_major_gridlines = True
        value_axis.major_gridlines.format.line.color.rgb = rgb('E2E8F0')
        value_axis.tick_labels.font.color.rgb = rgb(SLATE)
        value_axis.number_format = '#,##0' if money_axis else '0'
        value_axis.number_format_is_linked = False
        chart.category_axis.tick_labels.font.color.rgb = rgb('1E293B')
        chart.category_axis.tick_labels.font.size = Pt(11)
        value_axis.tick_labels.font.size = Pt(10)
        plot = chart.plots[0]
        plot.gap_width = 60
        plot.has_data_labels = True
        plot.data_labels.font.size = Pt(10)
        plot.data_labels.number_format = '#,##0'
        plot.data_labels.number_format_is_linked = False
        for index, (_, _, color) in enumerate(series):
            fill = plot.series[index].format.fill
            fill.solid()
            fill.fore_color.rgb = rgb(color)
        chart.point_index = {original: position for position, original in enumerate(order)}
        return chart

    totals = summary['totals']

    # 1. Kapak
    page['number'] += 1
    cover = presentation.slides.add_slide(blank)
    background = cover.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, presentation.slide_width, presentation.slide_height)
    background.fill.solid()
    background.fill.fore_color.rgb = rgb(NAVY)
    background.line.fill.background()
    stripe = cover.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.8), Inches(3.55), Inches(1.4), Inches(0.08))
    stripe.fill.solid()
    stripe.fill.fore_color.rgb = rgb(SKY)
    stripe.line.fill.background()
    text_box(cover, 0.8, 2.2, 11, 1.2, 'Satış Özet Raporu', size=48, bold=True, color='FFFFFF')
    text_box(cover, 0.8, 3.85, 11, 0.6, period, size=22, color='BFDBFE')
    text_box(
        cover, 0.8, 4.6, 11, 1.2,
        [
            f"{totals['sales']} satış · {short_money(totals['amount'])} · {totals['deposits']} kapora · {totals['reservations']} rezerv",
            f"Oluşturulma: {summary['generated_at']:%d.%m.%Y %H:%M}",
        ],
        size=16, color='E2E8F0',
    )

    # 2. Genel bakış
    slide = new_slide('Genel bakış', 'Seçili dönemdeki satış hareketleri ve bugünkü arsa durumu')
    tile(slide, 0.5, 1.4, 2.95, 'Satılan arsa', totals['sales'], f"{totals['standalone_sales']} müstakil · {totals['shared_sales']} hisse", EMERALD)
    tile(slide, 3.6, 1.4, 2.95, 'Satış tutarı', short_money(totals['amount']), money(totals['amount']), VIOLET)
    tile(slide, 6.7, 1.4, 2.95, 'Kapora alınan', totals['deposits'], 'Ön ödemesi alınan arsalar', BLUE)
    tile(slide, 9.8, 1.4, 2.95, 'Rezerve edilen', totals['reservations'], 'Müşterinin ayırttığı arsalar', AMBER)
    text_box(slide, 0.5, 3.15, 12, 0.4, f"Arsa durumu (bugün) · toplam {totals['lands']} arsa", size=15, bold=True)
    statuses = summary['status_counts']
    chart = bar_chart(
        slide, 0.5, 3.55, 12.3, 3.3,
        [item['label'] for item in statuses], [('Arsa sayısı', [item['count'] for item in statuses], BLUE)],
    )
    for index, item in enumerate(statuses):
        point = chart.plots[0].series[0].points[chart.point_index[index]]
        point.format.fill.solid()
        point.format.fill.fore_color.rgb = rgb(STATUS_COLORS[item['status']])

    # 3. Bölgeler
    slide = new_slide('Bölgelere göre satış', 'Satış tutarına göre sıralı; toplam ve boşta sayıları bugünkü durumdur')
    regions = summary['regions']
    if regions:
        bar_chart(slide, 0.5, 1.35, 5.9, 5.5, [row['name'] for row in regions], [('Satış tutarı', [row['amount'] for row in regions], BLUE)], money_axis=True)
    table(
        slide, 6.7, 1.45, 6.1,
        ['Bölge', 'Satış', 'Tutar', 'Kapora', 'Toplam', 'Boşta'],
        [[row['name'], row['sales'], short_money(row['amount']), row['deposits'], row['lands'], row['available']] for row in regions],
        col_widths=[3, 1.1, 2.3, 1.3, 1.3, 1.2],
    )

    # 4. İller
    slide = new_slide('En çok satış yapılan iller', 'İlk 10 il')
    cities = summary['cities']
    table(
        slide, 0.5, 1.45, 12.3,
        ['İl', 'Satılan', 'Müstakil', 'Hisse', 'Satış tutarı', 'Kapora', 'Rezerv', 'Toplam arsa', 'Boşta'],
        [[row['name'], row['sales'], row['standalone_sales'], row['shared_sales'], money(row['amount']), row['deposits'],
          row['reservations'], row['lands'], row['available']] for row in cities],
        col_widths=[2.6, 1.2, 1.2, 1.1, 2.4, 1.2, 1.2, 1.5, 1.1],
        font_size=12,
    )

    # 5. Müstakil / hisseli
    slide = new_slide('Müstakil ve hisseli arsalar', 'Hisseli parseller paylara bölünür; her hisse ayrı arsa olarak satılır')
    ownership = summary['ownership']
    total_amount = sum((row['amount'] for row in ownership), Decimal('0'))
    for index, row in enumerate(ownership):
        share = f" · gelirin %{round(row['amount'] / total_amount * 100)}'i" if total_amount else ''
        tile(
            slide, 0.5 + index * 3.15, 1.4, 3.0, row['name'], short_money(row['amount']),
            f"{row['sales']} satış{share}", SKY if row['type'] == 'MUSTAKIL' else VIOLET,
        )
    text_box(
        slide, 0.5, 3.05, 6.1, 2.5,
        [f"{row['name']}: toplam {row['lands']} {'hisse' if row['type'] == 'HISSELI' else 'arsa'}, "
         f"{row['available']} boşta, {row['deposits']} kapora, {row['reservations']} rezerv" for row in ownership]
        + [f"Hisseli parsel sayısı: {summary['shared_parcel_count']}"],
        size=13, color='334155',
    )
    bar_chart(
        slide, 6.8, 1.35, 6.0, 5.5, ['Satılan', 'Kapora', 'Rezerv', 'Boşta'],
        [(row['name'], [row['sales'], row['deposits'], row['reservations'], row['available']], SKY if row['type'] == 'MUSTAKIL' else VIOLET)
         for row in ownership],
        horizontal=False, legend=True,
    )

    # 6. Hisseli parseller
    slide = new_slide('Hisseli parseller', f"Satılan hisse oranına göre ilk 10 · toplam {summary['shared_parcel_count']} hisseli parsel (bugünkü durum)")
    table(
        slide, 0.5, 1.45, 12.3,
        ['Parsel', 'Yer', 'Hisse', 'Satılan', 'Kapora', 'Rezerve', 'Boşta', 'Gelen para'],
        [[parcel['parcel'], parcel['place'], parcel['total'], parcel['counts']['TAPU'], parcel['counts']['KAPORA_ALINDI'],
          parcel['counts']['REZERV'], parcel['counts']['BOS'], money(parcel['amount'])] for parcel in summary['shared_parcels']],
        col_widths=[2.4, 3.6, 0.9, 1.0, 1.0, 1.0, 0.9, 2.0],
        font_size=12,
        text_cols=2,
    )

    # 7. Satış temsilcileri
    slide = new_slide('Satış temsilcileri', 'Satış, kaporayı kim girerse girsin rezervi yapan temsilciye yazılır · ilk 10')
    people = summary['people']
    table(
        slide, 0.5, 1.45, 6.6,
        ['Temsilci', 'Satış', 'Tutar', 'Kapora', 'Rezerv'],
        [[f"{index + 1}. {row['name']}", row['sales'], short_money(row['amount']), row['deposits'], row['reservations']]
         for index, row in enumerate(people)],
        col_widths=[3.2, 1.0, 2.2, 1.2, 1.2],
    )
    if people:
        bar_chart(slide, 7.4, 1.35, 5.4, 5.5, [row['name'] for row in people], [('Satış tutarı', [row['amount'] for row in people], EMERALD)], money_axis=True)

    # 8. İptal nedenleri
    slide = new_slide('İptal nedenleri', 'Seçili dönemde boşa alınan rezerv/kaporaların nedenleri')
    cancellations = summary['cancellations']
    if cancellations:
        bar_chart(slide, 0.5, 1.35, 7.4, 5.5, [row['reason'] for row in cancellations], [('İptal', [row['count'] for row in cancellations], 'EF4444')])
    table(
        slide, 8.2, 1.45, 4.6, ['Neden', 'Adet'], [[row['reason'], row['count']] for row in cancellations], col_widths=[3.6, 1],
    )

    output = BytesIO()
    presentation.save(output)
    return output.getvalue()


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------

class ReportFontMissing(RuntimeError):
    pass


FONT_CANDIDATES = [
    # (normal, kalın) – Türkçe karakter (ı, ş, ğ) içeren yaygın yazı tipleri.
    ('/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf'),
    ('/Library/Fonts/Arial.ttf', '/Library/Fonts/Arial Bold.ttf'),
    ('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'),
    ('/usr/share/fonts/dejavu/DejaVuSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf'),
    ('/usr/share/fonts/TTF/DejaVuSans.ttf', '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf'),
    ('C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/arialbd.ttf'),
]


def _register_fonts():
    """Türkçe karakterleri gösterebilen bir TTF yazı tipi kaydeder; REPORT_FONT_PATH(/_BOLD) ayarı önceliklidir."""
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    if 'ReportSans' in pdfmetrics.getRegisteredFontNames():
        return
    custom = getattr(settings, 'REPORT_FONT_PATH', '') or os.environ.get('REPORT_FONT_PATH', '')
    custom_bold = getattr(settings, 'REPORT_FONT_BOLD_PATH', '') or os.environ.get('REPORT_FONT_BOLD_PATH', '') or custom
    candidates = ([(custom, custom_bold)] if custom else []) + FONT_CANDIDATES
    for regular, bold in candidates:
        if os.path.exists(regular):
            pdfmetrics.registerFont(TTFont('ReportSans', regular))
            pdfmetrics.registerFont(TTFont('ReportSans-Bold', bold if os.path.exists(bold) else regular))
            return
    raise ReportFontMissing(
        'PDF için Türkçe karakterleri destekleyen bir yazı tipi bulunamadı. '
        'Sunucuda DejaVu/Arial kurun ya da REPORT_FONT_PATH ayarına bir .ttf dosyası yolu yazın.'
    )


def build_pdf(summary):
    from reportlab.graphics.charts.barcharts import HorizontalBarChart
    from reportlab.graphics.shapes import Drawing
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.platypus import KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    _register_fonts()
    color = lambda value: colors.HexColor(f'#{value}')  # noqa: E731
    page_size = landscape(A4)
    period = period_text(summary)
    totals = summary['totals']

    styles = {
        'title': ParagraphStyle('title', fontName='ReportSans-Bold', fontSize=34, leading=40, textColor=color(NAVY)),
        'subtitle': ParagraphStyle('subtitle', fontName='ReportSans', fontSize=16, leading=22, textColor=color(SLATE)),
        'h1': ParagraphStyle('h1', fontName='ReportSans-Bold', fontSize=18, leading=22, textColor=color(NAVY), spaceAfter=4),
        'note': ParagraphStyle('note', fontName='ReportSans', fontSize=10, leading=13, textColor=color(SLATE), spaceAfter=8),
        'body': ParagraphStyle('body', fontName='ReportSans', fontSize=11, leading=15, textColor=color('334155')),
        'tile_label': ParagraphStyle('tile_label', fontName='ReportSans', fontSize=10, textColor=color(SLATE)),
        'tile_value': ParagraphStyle('tile_value', fontName='ReportSans-Bold', fontSize=18, leading=22, textColor=color(NAVY)),
        'tile_hint': ParagraphStyle('tile_hint', fontName='ReportSans', fontSize=8.5, textColor=color('94A3B8')),
    }

    def on_page(canvas, document):
        canvas.saveState()
        canvas.setFillColor(color(NAVY))
        canvas.rect(0, page_size[1] - 1.1 * cm, page_size[0], 1.1 * cm, stroke=0, fill=1)
        canvas.setFillColor(colors.white)
        canvas.setFont('ReportSans-Bold', 11)
        canvas.drawString(1.5 * cm, page_size[1] - 0.72 * cm, 'Satış Özet Raporu')
        canvas.setFont('ReportSans', 9)
        canvas.drawRightString(page_size[0] - 1.5 * cm, page_size[1] - 0.72 * cm, period)
        canvas.setFillColor(color(SLATE))
        canvas.drawString(1.5 * cm, 0.8 * cm, f"Oluşturulma: {summary['generated_at']:%d.%m.%Y %H:%M}")
        canvas.drawRightString(page_size[0] - 1.5 * cm, 0.8 * cm, f'Sayfa {document.page}')
        canvas.restoreState()

    def section(title, note=''):
        parts = [Paragraph(title, styles['h1'])]
        if note:
            parts.append(Paragraph(note, styles['note']))
        return parts

    def data_table(headers, rows, col_widths, text_cols=1):
        if not rows:
            return Paragraph('Bu dönemde gösterilecek kayıt yok.', styles['body'])
        grid = Table([headers, *rows], colWidths=[width * cm for width in col_widths], repeatRows=1, hAlign='LEFT')
        grid.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (-1, -1), 'ReportSans'),
            ('FONTNAME', (0, 0), (-1, 0), 'ReportSans-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9.5),
            ('BACKGROUND', (0, 0), (-1, 0), color(NAVY)),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, color(LIGHT)]),
            ('ALIGN', (text_cols, 0), (-1, -1), 'RIGHT'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('LINEBELOW', (0, 0), (-1, -1), 0.25, color('E2E8F0')),
        ]))
        return grid

    def bar_chart(labels, values, bar_color, width_cm=24, money_values=False, bar_colors=None):
        if not values or not any(values):
            return Spacer(1, 0)
        row_height = 0.55 * cm
        height = row_height * len(values) + 1.2 * cm
        drawing = Drawing(width_cm * cm, height)
        chart = HorizontalBarChart()
        chart.x, chart.y = 5.5 * cm, 0.6 * cm
        chart.width, chart.height = (width_cm - 8) * cm, row_height * len(values)
        chart.data = [[float(value) for value in reversed(values)]]
        chart.categoryAxis.categoryNames = list(reversed(labels))
        chart.categoryAxis.labels.fontName = 'ReportSans'
        chart.categoryAxis.labels.fontSize = 9
        chart.categoryAxis.labels.boxAnchor = 'e'
        chart.valueAxis.valueMin = 0
        chart.valueAxis.labels.fontName = 'ReportSans'
        chart.valueAxis.labels.fontSize = 8
        chart.valueAxis.labelTextFormat = (lambda value: short_money(value).replace(' TL', '')) if money_values else '%d'
        chart.bars[0].fillColor = color(bar_color)
        chart.bars[0].strokeColor = None
        # Çubuk başına renk (ör. arsa durumları); veri ters sırada çizildiği için renkler de ters çevrilir.
        for index, item_color in enumerate(reversed(bar_colors or [])):
            chart.bars[(0, index)].fillColor = color(item_color)
        chart.barLabelFormat = (lambda value: short_money(value)) if money_values else '%d'
        chart.barLabels.fontName = 'ReportSans'
        chart.barLabels.fontSize = 8
        chart.barLabels.boxAnchor = 'w'
        chart.barLabels.dx = 3
        drawing.add(chart)
        drawing.hAlign = 'LEFT'
        return drawing

    def tiles(items):
        cells = [[
            [Paragraph(label, styles['tile_label']), Paragraph(str(value), styles['tile_value']), Paragraph(hint, styles['tile_hint'])]
            for label, value, hint, _ in items
        ]]
        grid = Table(cells, colWidths=[(page_size[0] - 3 * cm) / len(items)] * len(items), hAlign='LEFT')
        commands = [
            ('BOX', (0, 0), (-1, -1), 0.5, color('E2E8F0')),
            ('INNERGRID', (0, 0), (-1, -1), 0.5, color('E2E8F0')),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ]
        commands += [('LINEBEFORE', (index, 0), (index, 0), 3, color(item[3])) for index, item in enumerate(items)]
        grid.setStyle(TableStyle(commands))
        return grid

    story = [
        Spacer(1, 4 * cm),
        Paragraph('Satış Özet Raporu', styles['title']),
        Spacer(1, 0.4 * cm),
        Paragraph(period, styles['subtitle']),
        Spacer(1, 0.3 * cm),
        Paragraph(
            f"{totals['sales']} satış · {short_money(totals['amount'])} · {totals['deposits']} kapora · {totals['reservations']} rezerv",
            styles['subtitle'],
        ),
        PageBreak(),
    ]

    story += section('Genel bakış', 'Seçili dönemdeki satış hareketleri; arsa durumu bugünkü durumdur.')
    story.append(tiles([
        ('Satılan arsa', totals['sales'], f"{totals['standalone_sales']} müstakil · {totals['shared_sales']} hisse", EMERALD),
        ('Satış tutarı', short_money(totals['amount']), money(totals['amount']), VIOLET),
        ('Kapora alınan', totals['deposits'], 'Ön ödemesi alınan arsalar', BLUE),
        ('Rezerve edilen', totals['reservations'], 'Müşterinin ayırttığı arsalar', AMBER),
    ]))
    story.append(Spacer(1, 0.6 * cm))
    story += section(f"Arsa durumu (bugün) · toplam {totals['lands']} arsa")
    statuses = summary['status_counts']
    story.append(bar_chart(
        [item['label'] for item in statuses], [item['count'] for item in statuses], BLUE,
        bar_colors=[STATUS_COLORS[item['status']] for item in statuses],
    ))
    story.append(data_table(
        ['Durum', 'Arsa sayısı'],
        [[item['label'], item['count']] for item in statuses],
        [8, 4],
    ))
    story.append(PageBreak())

    regions = summary['regions']
    story += section('Bölgelere göre satış', 'Satış tutarına göre sıralı; toplam ve boşta sayıları bugünkü durumdur.')
    story.append(bar_chart([row['name'] for row in regions], [row['amount'] for row in regions], BLUE, money_values=True))
    story.append(data_table(
        ['Bölge', 'Satış', 'Müstakil', 'Hisse', 'Tutar', 'Kapora', 'Rezerv', 'Toplam', 'Boşta'],
        [[row['name'], row['sales'], row['standalone_sales'], row['shared_sales'], money(row['amount']), row['deposits'],
          row['reservations'], row['lands'], row['available']] for row in regions],
        [5, 2, 2, 2, 4.2, 2, 2, 2, 2],
    ))
    story.append(PageBreak())

    story += section('En çok satış yapılan iller', 'İlk 10 il')
    story.append(data_table(
        ['İl', 'Satış', 'Müstakil', 'Hisse', 'Tutar', 'Kapora', 'Rezerv', 'Toplam', 'Boşta'],
        [[row['name'], row['sales'], row['standalone_sales'], row['shared_sales'], money(row['amount']), row['deposits'],
          row['reservations'], row['lands'], row['available']] for row in summary['cities']],
        [5, 2, 2, 2, 4.2, 2, 2, 2, 2],
    ))
    story.append(Spacer(1, 0.8 * cm))

    ownership = summary['ownership']
    total_amount = sum((row['amount'] for row in ownership), Decimal('0'))
    story.append(KeepTogether(
        section('Müstakil ve hisseli arsalar', f"Hisseli parsel sayısı: {summary['shared_parcel_count']}")
        + [data_table(
            ['Tapu tipi', 'Satış', 'Tutar', 'Gelir payı', 'Kapora', 'Rezerv', 'Toplam', 'Boşta'],
            [[row['name'], row['sales'], money(row['amount']),
              f"%{round(row['amount'] / total_amount * 100)}" if total_amount else '—',
              row['deposits'], row['reservations'], row['lands'], row['available']] for row in ownership],
            [5, 2, 4.2, 2.5, 2, 2, 2, 2],
        )]
    ))
    story.append(PageBreak())

    story += section('Hisseli parseller', 'Satılan hisse oranına göre ilk 10 (bugünkü durum).')
    story.append(data_table(
        ['Parsel', 'Yer', 'Hisse', 'Satılan', 'Kapora', 'Rezerve', 'Boşta', 'Gelen para'],
        [[parcel['parcel'], parcel['place'], parcel['total'], parcel['counts']['TAPU'], parcel['counts']['KAPORA_ALINDI'],
          parcel['counts']['REZERV'], parcel['counts']['BOS'], money(parcel['amount'])] for parcel in summary['shared_parcels']],
        [4.2, 7, 1.6, 1.8, 1.8, 1.8, 1.6, 3.6],
        text_cols=2,
    ))
    story.append(PageBreak())

    people = summary['people']
    story += section('Satış temsilcileri', 'Satış, rezervi yapan temsilciye yazılır · ilk 10')
    story.append(bar_chart([row['name'] for row in people], [row['amount'] for row in people], EMERALD, money_values=True))
    story.append(data_table(
        ['Temsilci', 'Satış', 'Tutar', 'Kapora', 'Rezerv'],
        [[f"{index + 1}. {row['name']}", row['sales'], money(row['amount']), row['deposits'], row['reservations']]
         for index, row in enumerate(people)],
        [8, 2.5, 5, 2.5, 2.5],
    ))
    story.append(PageBreak())

    cancellations = summary['cancellations']
    story += section('İptal nedenleri', 'Seçili dönemde boşa alınan rezerv/kaporaların nedenleri.')
    story.append(bar_chart([row['reason'] for row in cancellations], [row['count'] for row in cancellations], 'EF4444'))
    story.append(data_table(['Neden', 'Adet'], [[row['reason'], row['count']] for row in cancellations], [10, 3]))

    output = BytesIO()
    document = SimpleDocTemplate(
        output, pagesize=page_size, leftMargin=1.5 * cm, rightMargin=1.5 * cm, topMargin=1.8 * cm, bottomMargin=1.5 * cm,
        title='Satış Özet Raporu', author='Arsa Takip CRM', subject=period,
    )
    document.build(story, onFirstPage=on_page, onLaterPages=on_page)
    return output.getvalue()
