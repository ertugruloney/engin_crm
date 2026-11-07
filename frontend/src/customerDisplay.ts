// Müşteri listesi ve müşteri kartının ortak etiketleri ve yardımcıları.
import type { CancelDetail, CancelReason, Customer, CustomerLandRecord, CustomerSource } from './api';

export const SOURCE_LABELS: Record<Exclude<CustomerSource, ''>, string> = {
  referans: 'Referans',
  ilan: 'İlan sitesi',
  sosyal_medya: 'Sosyal medya',
  web: 'Web sitesi',
  ofis: 'Ofis ziyareti / tabela',
  telefon: 'Telefon',
  diger: 'Diğer',
};

export const OUTCOME_INFO: Record<CustomerLandRecord['outcome'], { label: string; badge: string; dot: string }> = {
  sold: { label: 'Satın aldı', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  active: { label: 'Süreç devam ediyor', badge: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-500' },
  cancelled: { label: 'İptal etti', badge: 'bg-rose-50 text-rose-700 ring-rose-200', dot: 'bg-rose-500' },
};

// Daha önce rezervasyonu bozmuş ve şu an açık süreci olmayan müşteri: aynı bölgede arsa çıkınca aranmalı.
export const isHotLead = (customer: Pick<Customer, 'cancelled_count' | 'active_count'>) =>
  customer.cancelled_count > 0 && customer.active_count === 0;

export const regionKey = (il: string | null | undefined, ilce: string | null | undefined) =>
  `${(il ?? '').trim().toLocaleLowerCase('tr-TR')}|${(ilce ?? '').trim().toLocaleLowerCase('tr-TR')}`;

export const formatCurrency = (amount: string | number | null | undefined) =>
  amount === null || amount === undefined || amount === ''
    ? '—'
    : new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(Number(amount));

export const formatDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2)).toLocaleUpperCase('tr-TR');
};

// WhatsApp için uluslararası numara (yalnızca rakam): 0532…, 532… ve +90 532… -> 90532…
export const whatsappNumber = (phone: string | null | undefined) => {
  let digits = (phone ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith('5')) digits = `90${digits}`;
  else if (digits.length === 11 && digits.startsWith('0')) digits = `9${digits}`;
  return digits.length >= 10 ? digits : null;
};

// Numara geçerliyse, mesajı hazır yazılmış WhatsApp sohbet bağlantısı.
export const whatsappLink = (phone: string | null | undefined, message: string) => {
  const number = whatsappNumber(phone);
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(message)}` : null;
};


// Arsa boşa alınırken seçilen iptal nedenleri ve alt seçimleri (backend: models.CANCEL_REASON_TREE ile aynı).
export const CANCEL_REASON_TREE: {
  value: CancelReason;
  label: string;
  hint: string;
  details: { value: CancelDetail; label: string }[];
}[] = [
  {
    value: 'fiyat_odeme',
    label: 'Fiyat / ödeme sorunu',
    hint: 'Ödeme karşılanamadı, kredi çıkmadı, fiyatta veya taksitte anlaşılamadı',
    details: [
      { value: 'odeme_karsilanamadi', label: 'Ödeme karşılanamadı' },
      { value: 'kredi_cikmadi', label: 'Kredi çıkmadı' },
      { value: 'fiyat_anlasilamadi', label: 'Fiyatta anlaşılamadı' },
      { value: 'taksit_anlasilamadi', label: 'Taksitte anlaşılamadı' },
    ],
  },
  {
    value: 'baska_arsa',
    label: 'Başka bir arsayı tercih etti',
    hint: 'Bizden başka bir arsa aldı ya da rakipten aldı',
    details: [
      { value: 'bizden_aldi', label: 'Bizden başka arsa aldı' },
      { value: 'rakipten_aldi', label: 'Rakipten aldı' },
    ],
  },
  {
    value: 'ozellik',
    label: 'Arsanın özelliği uymadı',
    hint: 'İmar, yol/cephe, hisseli tapu gibi nedenler',
    details: [
      { value: 'imar', label: 'İmar durumu' },
      { value: 'yol_cephe', label: 'Yol / cephe' },
      { value: 'hisseli', label: 'Hisseli tapu' },
    ],
  },
  { value: 'yerinde_gordu', label: 'Arsayı yerinde görünce vazgeçti', hint: 'Gösterilen yer doğruydu ama müşteri beğenmedi', details: [] },
  { value: 'yanlis_yer', label: 'Satışçı yanlış yeri göstermiş', hint: 'Müşteriye gösterilen yer satılan arsa değildi', details: [] },
  {
    value: 'ulasilamiyor',
    label: 'Müşteriye ulaşılamıyor / vazgeçti',
    hint: 'Dönüş yapmıyor, rezerv süresi doldu veya kişisel nedenler',
    details: [
      { value: 'donus_yok', label: 'Dönüş yapmıyor' },
      { value: 'sure_doldu', label: 'Rezerv süresi doldu' },
      { value: 'kisisel', label: 'Kişisel nedenler' },
    ],
  },
  { value: 'diger', label: 'Diğer', hint: 'Açıklama yazmak zorunlu', details: [] },
  // Sistem verir: arsa başka bir müşteriye geçtiğinde.
  { value: 'devredildi', label: 'Arsa başka müşteriye verildi', hint: '', details: [] },
];

// Ör. "Fiyat / ödeme sorunu – Kredi çıkmadı"
export const cancelReasonLabel = (reason: string | null | undefined, detail?: string | null) => {
  const item = CANCEL_REASON_TREE.find(entry => entry.value === reason);
  if (!item) return reason ? reason : 'Belirtilmemiş';
  const sub = item.details.find(entry => entry.value === detail);
  return sub ? `${item.label} – ${sub.label}` : item.label;
};
