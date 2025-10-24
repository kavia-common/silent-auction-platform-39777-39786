import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

test('renders Home with Create or Join buttons', () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <App />
    </MemoryRouter>
  );
  const create = screen.getByText(/Create/i);
  const join = screen.getByText(/Join/i);
  expect(create && join).toBeTruthy();
});
