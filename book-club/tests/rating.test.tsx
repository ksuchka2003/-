import { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RatingStars } from '../src/ui/RatingStars';
afterEach(cleanup);
it('прежние 9 баллов показываются как четыре с половиной звезды; клавиши меняют половинки', () => {
  function Form() {
    const [v, setV] = useState<number | null>(9);
    return <RatingStars value={v} onChange={setV} />;
  }
  render(<Form />);
  const slider = screen.getByRole('slider', { name: 'Моя оценка' });
  expect(slider).toHaveAttribute('aria-valuenow', '4.5');
  fireEvent.keyDown(slider, { key: 'ArrowLeft' });
  expect(slider).toHaveAttribute('aria-valuenow', '4');
  fireEvent.keyDown(slider, { key: 'Home' });
  expect(slider).toHaveAttribute('aria-valuenow', '0.5');
  fireEvent.keyDown(slider, { key: 'End' });
  expect(slider).toHaveAttribute('aria-valuenow', '5');
  fireEvent.click(screen.getByRole('button', { name: 'Убрать оценку' }));
  expect(slider).toHaveAttribute('aria-valuetext', 'Без оценки');
});
it('публичная оценка отображается звёздами без элементов редактирования', () => {
  render(<RatingStars value={7} label="Оценка участника" />);
  expect(screen.getByLabelText('Оценка участника: 3,5 из 5')).toBeVisible();
  expect(screen.queryByRole('slider')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
});
