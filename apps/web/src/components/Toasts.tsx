"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

const Ctx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(Ctx);

/** Bottom-centre toasts, 2.6 s each (prototype `toast`). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([]);
  const toast = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setItems((t) => [...t, { id, msg }]);
    setTimeout(() => setItems((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);
  return (
    <Ctx.Provider value={toast}>
      {children}
      <div className="toasts" id="toasts" aria-live="polite">
        {items.map((t) => (
          <div className="toast" key={t.id}>
            <i />
            {t.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
