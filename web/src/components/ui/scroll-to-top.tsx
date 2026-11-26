import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ScrollToTopProps {
  /** Cuộn quá ngưỡng này (px) thì nút mới hiện. */
  threshold?: number;
  className?: string;
}

/** Nút nổi "Lên đầu trang" ở góc phải dưới. Trang cuộn theo cửa sổ (window). */
export function ScrollToTop({ threshold = 400, className }: ScrollToTopProps) {
  const [visible, setVisible] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={reduce ? undefined : { opacity: 0, y: 12, scale: 0.9 }}
          animate={reduce ? undefined : { opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? undefined : { opacity: 0, y: 12, scale: 0.9 }}
          transition={{ duration: 0.18 }}
          className={cn('fixed bottom-6 right-6 z-40', className)}
        >
          <Button
            size="icon"
            className="h-11 w-11 rounded-full shadow-lg"
            aria-label="Lên đầu trang"
            title="Lên đầu trang"
            onClick={() => window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })}
          >
            <ArrowUp />
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
