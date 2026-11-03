import { getCountryCallingCode, isValidPhoneNumber, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

export const splitPhoneNumber = (value: string): { country: CountryCode; number: string } => {
  const international = value.trim().startsWith('+')
    ? parsePhoneNumberFromString(value)
    : undefined;
  if (international?.country) {
    return { country: international.country, number: international.nationalNumber };
  }
  return { country: 'TR', number: value };
};

export const formatInternationalPhone = (number: string, country: CountryCode): string => {
  const trimmedNumber = number.trim();
  if (!trimmedNumber) return '';

  const parsed = parsePhoneNumberFromString(trimmedNumber, country);
  if (parsed) return parsed.number;

  const digits = trimmedNumber.replace(/\D/g, '').replace(/^0+/, '');
  return digits ? `+${getCountryCallingCode(country)}${digits}` : '';
};

export const getPhoneValidationError = (number: string, country: CountryCode): string | null => {
  if (!number.trim()) return null;
  return isValidPhoneNumber(number, country) ? null : 'Geçerli bir telefon numarası girin.';
};
