import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SlaIndicator } from './SlaIndicator';

describe('SlaIndicator', () => {
  it('показывает длительность в человекочитаемом виде', () => {
    render(<SlaIndicator state="ok" secondsInStatus={135 * 60} limitSeconds={null} />);
    expect(screen.getByText('2 ч 15 мин')).toBeInTheDocument();
  });

  it('называет норматив в подсказке', () => {
    render(<SlaIndicator state="warning" secondsInStatus={1200} limitSeconds={1500} />);
    expect(screen.getByTitle(/норматив 25 мин/)).toBeInTheDocument();
  });

  it('у терминального статуса объясняет отсутствие норматива', () => {
    render(<SlaIndicator state="none" secondsInStatus={99_999} limitSeconds={null} />);
    expect(screen.getByTitle(/норматива нет/)).toBeInTheDocument();
  });

  it('просрочку объявляет текстом, а не только цветом', () => {
    render(<SlaIndicator state="overdue" secondsInStatus={3000} limitSeconds={1500} />);
    expect(screen.getByText('— просрочен')).toBeInTheDocument();
  });

  it('в пределах норматива лишнего текста не добавляет', () => {
    render(<SlaIndicator state="ok" secondsInStatus={60} limitSeconds={1500} />);
    expect(screen.queryByText('— просрочен')).not.toBeInTheDocument();
  });
});
