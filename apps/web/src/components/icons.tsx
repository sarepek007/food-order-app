import type { SVGProps } from 'react';

/**
 * Иконки — инлайн-SVG без внешних зависимостей.
 * Все декоративные: aria-hidden, чтобы не засорять доступное имя кнопки,
 * и currentColor, чтобы наследовать цвет контекста.
 */
type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, className = '', ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`size-4 shrink-0 ${className}`}
      {...rest}
    >
      {children}
    </svg>
  );
}

export const ArrowRightIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 10h12M11 5l5 5-5 5" />
  </Icon>
);

export const ArrowLeftIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M16 10H4M9 15l-5-5 5-5" />
  </Icon>
);

export const CourierIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="10" cy="6" r="2.6" />
    <path d="M4.5 16.5a5.5 5.5 0 0 1 11 0" />
  </Icon>
);

export const CancelIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="10" cy="10" r="6.5" />
    <path d="M7.5 7.5l5 5M12.5 7.5l-5 5" />
  </Icon>
);

export const SearchIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="9" cy="9" r="5" />
    <path d="M13 13l4 4" />
  </Icon>
);

export const FilterIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 5h14M6 10h8M8.5 15h3" />
  </Icon>
);

export const ClockIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="10" cy="10" r="6.5" />
    <path d="M10 6.5V10l2.5 1.8" />
  </Icon>
);

export const CheckIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4.5 10.5l3.5 3.5 7.5-8" />
  </Icon>
);

export const AlertIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10 3.5l7 12.5H3l7-12.5Z" />
    <path d="M10 8v3.2M10 13.6v.1" />
  </Icon>
);

export const InboxIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 12l2.2-6.2A1.5 1.5 0 0 1 6.6 5h6.8a1.5 1.5 0 0 1 1.4 1L17 12v3H3v-3Z" />
    <path d="M3 12h3.5l1 2h5l1-2H17" />
  </Icon>
);

export const PlusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10 4.5v11M4.5 10h11" />
  </Icon>
);

export const MinusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4.5 10h11" />
  </Icon>
);

export const SwapIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 7h9l-2.5-2.5M16 13H7l2.5 2.5" />
  </Icon>
);

export const RefreshIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M16 10a6 6 0 1 1-1.8-4.2M16 3.5V7h-3.5" />
  </Icon>
);
