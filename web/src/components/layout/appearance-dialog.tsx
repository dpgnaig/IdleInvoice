import { Check, Moon, Sun } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PALETTES, useTheme, type Theme } from '@/lib/theme';

const MODES: { id: Theme; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Sáng', icon: Sun },
  { id: 'dark', label: 'Tối', icon: Moon },
];

export function AppearanceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { theme, setTheme, palette, setPalette } = useTheme();

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Giao diện" description="Chế độ hiển thị và màu chủ đạo của hệ thống.">
      <div className="grid gap-5">
        <section className="grid gap-2">
          <h3 className="text-sm font-medium">Chế độ</h3>
          <div className="grid grid-cols-2 gap-2">
            {MODES.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTheme(id)}
                aria-pressed={theme === id}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors',
                  theme === id ? 'border-primary bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="grid gap-2">
          <h3 className="text-sm font-medium">Màu chủ đạo</h3>
          <div className="grid grid-cols-5 gap-2">
            {PALETTES.map((p) => {
              const selected = palette === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPalette(p.id)}
                  aria-pressed={selected}
                  title={p.label}
                  className="flex flex-col items-center gap-1.5 rounded-lg p-1.5 text-xs text-muted-foreground hover:bg-accent/50"
                >
                  <span
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-full ring-offset-background transition-shadow',
                      selected && 'ring-2 ring-ring ring-offset-2',
                    )}
                    style={{ backgroundColor: p.swatch }}
                  >
                    {selected && <Check className="h-4 w-4 text-white" />}
                  </span>
                  {p.label}
                </button>
              );
            })}
          </div>
        </section>

        <div className="flex justify-end">
          <Button type="button" onClick={() => onOpenChange(false)}>
            Xong
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
