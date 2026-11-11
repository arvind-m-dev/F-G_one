'use client';
import { useEffect, useState } from 'react';

/** The shortcut modifier to show: "⌘" on Apple devices, "Ctrl" everywhere else. "Ctrl" until mounted so server and client match. */
export function useModKey(): '⌘' | 'Ctrl' {
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)), []);
  return mac ? '⌘' : 'Ctrl';
}
