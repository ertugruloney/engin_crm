// İl adı → plaka ve plaka → coğrafi bölge eşlemeleri (gösterge paneli ve raporlar ortak kullanır).

export const normalizeCityName = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ş/g, 's')
    .replace(/ç/g, 'c')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u');

// Plaka sırasına göre 81 il (normalize edilmiş adlar).
const PROVINCE_NAMES =
  'adana,adiyaman,afyonkarahisar,agri,amasya,ankara,antalya,artvin,aydin,balikesir,bilecik,bingol,bitlis,bolu,' +
  'burdur,bursa,canakkale,cankiri,corum,denizli,diyarbakir,edirne,elazig,erzincan,erzurum,eskisehir,gaziantep,' +
  'giresun,gumushane,hakkari,hatay,isparta,mersin,istanbul,izmir,kars,kastamonu,kayseri,kirklareli,kirsehir,' +
  'kocaeli,konya,kutahya,malatya,manisa,kahramanmaras,mardin,mugla,mus,nevsehir,nigde,ordu,rize,sakarya,samsun,' +
  'siirt,sinop,sivas,tekirdag,tokat,trabzon,tunceli,sanliurfa,usak,van,yozgat,zonguldak,aksaray,bayburt,karaman,' +
  'kirikkale,batman,sirnak,bartin,ardahan,igdir,yalova,karabuk,kilis,osmaniye,duzce';

const TURKEY_PROVINCE_CODES: Record<string, string> = {
  ...Object.fromEntries(PROVINCE_NAMES.split(',').map((name, index) => [name, String(index + 1).padStart(2, '0')])),
  afyon: '03',
  icel: '33',
  maras: '46',
  urfa: '63',
};

export const getProvincePlate = (city: string): string | undefined => TURKEY_PROVINCE_CODES[normalizeCityName(city)];

export const REGIONS: { value: string; label: string; plates: string[] }[] = [
  { value: 'marmara', label: 'Marmara', plates: '10,11,16,17,22,34,39,41,54,59,77'.split(',') },
  { value: 'ege', label: 'Ege', plates: '03,09,20,35,43,45,48,64'.split(',') },
  { value: 'akdeniz', label: 'Akdeniz', plates: '01,07,15,31,32,33,46,80'.split(',') },
  { value: 'ic-anadolu', label: 'İç Anadolu', plates: '06,18,26,38,40,42,50,51,58,66,68,70,71'.split(',') },
  {
    value: 'karadeniz',
    label: 'Karadeniz',
    plates: '05,08,14,19,28,29,37,52,53,55,57,60,61,67,69,74,78,81'.split(','),
  },
  { value: 'dogu-anadolu', label: 'Doğu Anadolu', plates: '04,12,13,23,24,25,30,36,44,49,62,65,75,76'.split(',') },
  { value: 'guneydogu', label: 'Güneydoğu Anadolu', plates: '02,21,27,47,56,63,72,73,79'.split(',') },
];

export const UNKNOWN_REGION = 'Bilinmeyen';

export const getRegionLabel = (city: string) => {
  const plate = getProvincePlate(city);
  return REGIONS.find(region => plate && region.plates.includes(plate))?.label ?? UNKNOWN_REGION;
};
