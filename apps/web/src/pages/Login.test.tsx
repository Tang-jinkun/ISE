import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Login from './Login';

const mocks = vi.hoisted(() => ({
  fetchUser: vi.fn(),
  login: vi.fn(),
  navigate: vi.fn(),
  register: vi.fn(),
}));

vi.mock('@/api/auth', () => ({
  login: mocks.login,
  register: mocks.register,
}));

vi.mock('@/stores/userStore', () => ({
  useUserStore: (selector: (state: { fetchUser: typeof mocks.fetchUser }) => unknown) =>
    selector({ fetchUser: mocks.fetchUser }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}));

describe('Login registration', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.register.mockResolvedValue({
      code: 400,
      data: null,
      message: 'registration rejected',
    });
  });

  function renderRegistrationForm() {
    const view = render(<Login />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'auth.registerTitle' }), {
      button: 0,
      ctrlKey: false,
    });
    const username = view.container.querySelector<HTMLInputElement>('input[name="username"]');
    if (!username) throw new Error('Registration form did not render');
    const form = username.closest('form');
    if (!form) throw new Error('Registration form is missing');
    return { ...view, form };
  }

  it('renders registration without verification controls', () => {
    const { container, form } = renderRegistrationForm();

    expect(container.querySelector('input[name="code"]')).not.toBeInTheDocument();
    expect(within(form).getAllByRole('button')).toHaveLength(1);
  });

  it('submits exactly email, username, and password', async () => {
    const { container, form } = renderRegistrationForm();
    const values = {
      email: 'new-user@example.com',
      username: 'new-user',
      password: 'password-123',
    };

    fireEvent.change(container.querySelector('input[name="username"]')!, {
      target: { value: values.username },
    });
    fireEvent.change(container.querySelector('input[name="email"]')!, {
      target: { value: values.email },
    });
    fireEvent.change(container.querySelector('input[name="password"]')!, {
      target: { value: values.password },
    });
    fireEvent.change(container.querySelector('input[name="confirmPassword"]')!, {
      target: { value: values.password },
    });
    const legacyCode = container.querySelector('input[name="code"]');
    if (legacyCode) {
      fireEvent.change(legacyCode, { target: { value: '123456' } });
    }
    fireEvent.submit(form);

    await waitFor(() => expect(mocks.register).toHaveBeenCalledTimes(1));
    expect(mocks.register).toHaveBeenCalledWith(values);
  });
});
