import { MessageCircle } from 'lucide-react';
import { whatsappLink } from '../customerDisplay';

const STYLES = {
  solid: 'gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700',
  soft: 'gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100',
  link: 'gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800',
  icon: 'h-9 w-9 justify-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100',
} as const;

// Müşteriyle WhatsApp sohbetini, mesajı hazır yazılmış olarak yeni sekmede açar.
export default function WhatsAppButton({
  phone,
  message,
  label = "WhatsApp'tan yaz",
  variant = 'soft',
}: {
  phone: string | null | undefined;
  message: string;
  label?: string;
  variant?: keyof typeof STYLES;
}) {
  const href = whatsappLink(phone, message);
  const iconSize = variant === 'link' ? 13 : variant === 'icon' ? 17 : 16;
  const content = (
    <>
      <MessageCircle size={iconSize} />
      {variant === 'icon' ? <span className="sr-only">{label}</span> : label}
    </>
  );

  if (!href) {
    return (
      <span
        title="Geçerli telefon numarası yok"
        aria-disabled="true"
        onClick={event => event.stopPropagation()}
        className={`inline-flex cursor-not-allowed items-center opacity-40 ${STYLES[variant]}`}
      >
        {content}
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={variant === 'icon' ? label : undefined}
      onClick={event => event.stopPropagation()}
      className={`inline-flex items-center transition-colors ${STYLES[variant]}`}
    >
      {content}
    </a>
  );
}
