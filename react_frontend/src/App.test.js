import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

test('renders Home with Create Auction or Join Auction content', () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <App />
    </MemoryRouter>
  );
  const create = screen.getByText(/Create Auction/i);
  const join = screen.getByText(/Join Auction/i);
  expect(create || join).toBeTruthy();
});
