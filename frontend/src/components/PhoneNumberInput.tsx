import { getCountries, getCountryCallingCode, type CountryCode } from 'libphonenumber-js';

const countryNames = new Intl.DisplayNames(['tr'], { type: 'region' });

const countries = getCountries()
  .map(country => ({
    code: country,
    name: countryNames.of(country) || country,
    callingCode: getCountryCallingCode(country),
  }))
  .sort((left, right) => left.name.localeCompare(right.name, 'tr'));

interface PhoneNumberInputProps {
  value: string;
  country: CountryCode;
  onChange: (value: string) => void;
  onCountryChange: (country: CountryCode) => void;
  onBlur?: () => void;
  error?: string | null;
}

export default function PhoneNumberInput({
  value,
  country,
  onChange,
  onCountryChange,
  onBlur,
  error,
}: PhoneNumberInputProps) {
  return (
    <>
      <div className="mt-1 flex min-w-0">
        <select
          aria-label="Telefon ülke kodu"
          value={country}
          onChange={event => onCountryChange(event.target.value as CountryCode)}
          className="max-w-[48%] rounded-l-lg border border-r-0 border-slate-300 bg-slate-50 px-2 py-2 text-sm text-slate-700 sm:max-w-[45%]"
        >
          {countries.map(item => (
            <option key={item.code} value={item.code}>
              {item.name} (+{item.callingCode})
            </option>
          ))}
        </select>
        <input
          type="tel"
          maxLength={30}
          autoComplete="tel-national"
          value={value}
          onChange={event => onChange(event.target.value)}
          onBlur={onBlur}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'phone-number-error' : undefined}
          className={`min-w-0 flex-1 rounded-r-lg border px-3 py-2 ${error ? 'border-red-500' : 'border-slate-300'}`}
        />
      </div>
      {error && <span id="phone-number-error" role="alert" className="mt-1 block text-xs text-red-600">{error}</span>}
    </>
  );
}
