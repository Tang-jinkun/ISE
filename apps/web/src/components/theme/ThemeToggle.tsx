import { Button } from '../ui/button';
import { useTheme } from './ThemeProvider';
import { Moon, Sun } from 'lucide-react';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button
      variant="outline"
      onClick={toggle}
      className="size-9 p-0"
      aria-label="Toggle theme"
    >
      <Sun className={`size-4 ${theme === 'dark' ? 'hidden' : ''}`} />
      <Moon className={`size-4 ${theme === 'dark' ? '' : 'hidden'}`} />
    </Button>
  );
}
