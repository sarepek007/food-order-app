import type { SVGProps } from 'react';

/** Лепесток: широкая капля от основания к острию. Ширина важна — узкие
 *  лепестки на мелком размере читаются как трава, а не как цветок. */
const PETAL = 'M16 19C12.4 15.4 12.4 11.4 16 8c3.6 3.4 3.6 7.4 0 11Z';

/**
 * Лотос (бадм цецг) в круге неба — мотив герба и флага Калмыкии.
 *
 * Лепестки разделены обводкой цвета фона: на 28 пикселях сплошные белые
 * фигуры сливаются в пятно. Золотая дуга внизу — солнце над степью.
 *
 * Знак декоративный: aria-hidden, смысл несёт текстовая подпись рядом.
 */
export function LotusMark({ className = '', ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className={`size-7 shrink-0 ${className}`}
      {...rest}
    >
      <rect width="32" height="32" rx="8" fill="var(--color-accent)" />

      <g
        fill="#ffffff"
        stroke="var(--color-accent)"
        strokeWidth="1"
        strokeLinejoin="round"
        transform="translate(0 -0.5)"
      >
        {/* Боковые лепестки рисуются первыми, центральный ложится поверх. */}
        <path d={PETAL} transform="rotate(-52 16 19)" />
        <path d={PETAL} transform="rotate(52 16 19)" />
        <path d={PETAL} transform="rotate(-26 16 19)" />
        <path d={PETAL} transform="rotate(26 16 19)" />
        <path d={PETAL} />
      </g>

      {/* Дуга основания — солнце над степью. */}
      <path
        d="M8.5 22.6c2.4 2 4.9 3 7.5 3s5.1-1 7.5-3"
        fill="none"
        stroke="var(--color-gold)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
