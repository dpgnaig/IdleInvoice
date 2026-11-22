import type * as React from 'react';
import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner';
import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useTheme } from '@/lib/theme';

type Tone = 'success' | 'destructive' | 'warning' | 'info';

const TONE_ICON: Record<Tone, LucideIcon> = {
  success: CheckCircle2,
  destructive: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const TONE_VARIANT: Record<Tone, 'success' | 'destructive' | 'warning' | 'info'> = {
  success: 'success',
  destructive: 'destructive',
  warning: 'warning',
  info: 'info',
};

function show(tone: Tone, message: React.ReactNode) {
  const Icon = TONE_ICON[tone];
  return sonnerToast.custom(
    () => (
      <Alert variant={TONE_VARIANT[tone]} className="w-[360px] max-w-[calc(100vw-2rem)] shadow-lg animate__animated animate__fadeIn">
        <Icon />
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    ),
    { duration: 4000, unstyled: true },
  );
}

export const toast = {
  success: (message: React.ReactNode) => show('success', message),
  error: (message: React.ReactNode) => show('destructive', message),
  warning: (message: React.ReactNode) => show('warning', message),
  info: (message: React.ReactNode) => show('info', message),
};

export function Toaster({ ...props }: React.ComponentProps<typeof SonnerToaster>) {
  const { theme } = useTheme();
  return (
    <SonnerToaster
      theme={theme}
      position="top-right"
      offset={{ top: 16, right: 8 }}
      mobileOffset={{ top: 16, right: 8, left: 8 }}
      {...props}
    />
  );
}
