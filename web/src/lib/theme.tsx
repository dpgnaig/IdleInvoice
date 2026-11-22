import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark';
export type PaletteId = 'pink' | 'blue' | 'emerald' | 'violet' | 'amber';

type Palette = {
  id: PaletteId;
  label: string;
  swatch: string;
  light: { primary: string; accent: string; accentForeground: string };
  dark: { primary: string };
};

export const PALETTES: Palette[] = [
  {
    id: 'pink',
    label: 'Hồng',
    swatch: 'hsl(330 81% 56%)',
    light: { primary: '330 81% 56%', accent: '330 80% 96%', accentForeground: '330 75% 38%' },
    dark: { primary: '330 85% 67%' },
  },
  {
    id: 'blue',
    label: 'Xanh dương',
    swatch: 'hsl(221 83% 53%)',
    light: { primary: '221 83% 53%', accent: '221 83% 96%', accentForeground: '221 83% 34%' },
    dark: { primary: '217 91% 62%' },
  },
  {
    id: 'emerald',
    label: 'Xanh lá',
    swatch: 'hsl(160 84% 39%)',
    light: { primary: '160 84% 39%', accent: '160 84% 95%', accentForeground: '160 84% 26%' },
    dark: { primary: '158 64% 52%' },
  },
  {
    id: 'violet',
    label: 'Tím',
    swatch: 'hsl(262 83% 58%)',
    light: { primary: '262 83% 58%', accent: '262 83% 96%', accentForeground: '262 70% 40%' },
    dark: { primary: '262 90% 72%' },
  },
  {
    id: 'amber',
    label: 'Cam',
    swatch: 'hsl(32 95% 44%)',
    light: { primary: '32 95% 44%', accent: '32 95% 95%', accentForeground: '32 90% 30%' },
    dark: { primary: '36 96% 60%' },
  },
];

type ThemeContextValue = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  palette: PaletteId;
  setPalette: (p: PaletteId) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  setTheme: () => {},
  palette: 'pink',
  setPalette: () => {},
});

function initialTheme(): Theme {
  const saved = localStorage.getItem('ii-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function initialPalette(): PaletteId {
  const saved = localStorage.getItem('ii-palette');
  return PALETTES.some((p) => p.id === saved) ? (saved as PaletteId) : 'pink';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [palette, setPalette] = useState<PaletteId>(initialPalette);

  useEffect(() => {
    const root = document.documentElement;
    const current = PALETTES.find((p) => p.id === palette) ?? PALETTES[0];
    root.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('ii-theme', theme);
    localStorage.setItem('ii-palette', palette);

    if (theme === 'dark') {
      root.style.setProperty('--primary', current.dark.primary);
      root.style.setProperty('--ring', current.dark.primary);
      root.style.removeProperty('--accent');
      root.style.removeProperty('--accent-foreground');
    } else {
      root.style.setProperty('--primary', current.light.primary);
      root.style.setProperty('--ring', current.light.primary);
      root.style.setProperty('--accent', current.light.accent);
      root.style.setProperty('--accent-foreground', current.light.accentForeground);
    }
  }, [theme, palette]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, palette, setPalette }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
