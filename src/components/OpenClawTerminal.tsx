'use client';

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

type OpenClawTerminalProps = {
  chunk: string;
  sessionId?: string;
  onInput: (data: string) => void;
  className?: string;
  disabled?: boolean;
};

export function OpenClawTerminal({ chunk, sessionId, onInput, className, disabled = false }: OpenClawTerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const onInputRef = useRef(onInput);
  const disabledRef = useRef(disabled);

  useEffect(() => {
    onInputRef.current = onInput;
  }, [onInput]);

  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  useEffect(() => {
    if (!containerRef.current) return;

    const safeFit = () => {
      const term = terminalRef.current;
      const fitAddon = fitAddonRef.current;
      const container = containerRef.current;
      if (!term || !fitAddon || !container) return;

      fitAddon.fit();

      // Guard against occasional wrong char-width measurement that yields tiny columns.
      if (term.cols < 20 && container.clientWidth > 320) {
        const estimatedCols = Math.floor(container.clientWidth / 8.2);
        const fallbackCols = Math.max(40, Math.min(estimatedCols, 260));
        const nextRows = Math.max(term.rows || 24, 12);
        term.resize(fallbackCols, nextRows);
      }
    };

    const term = new Terminal({
      cursorBlink: true,
      convertEol: false,
      scrollback: 5000,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.3,
      theme: {
        background: '#0a0a0a',
        foreground: '#d4d4d4',
        cursor: '#67e8f9',
        selectionBackground: '#374151',
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddonRef.current = fitAddon;
    safeFit();

    // Some layouts report a transient narrow width at mount; refit a few times.
    const fitTimers = [
      setTimeout(() => safeFit(), 0),
      setTimeout(() => safeFit(), 80),
      setTimeout(() => safeFit(), 240),
      setTimeout(() => safeFit(), 600),
    ];

    const disposable = term.onData((data) => {
      if (!disabledRef.current) {
        onInputRef.current(data);
      }
    });

    terminalRef.current = term;

    const observer = new ResizeObserver(() => {
      safeFit();
    });
    observer.observe(containerRef.current);

    return () => {
      for (const timer of fitTimers) {
        clearTimeout(timer);
      }
      observer.disconnect();
      disposable.dispose();
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;

    if (chunk) {
      term.write(chunk);
    }
  }, [chunk]);

  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;
    term.reset();
  }, [sessionId]);

  return (
    <div
      ref={containerRef}
      className={className || 'h-72 w-full'}
      onClick={() => {
        fitAddonRef.current?.fit();
        terminalRef.current?.focus();
      }}
    />
  );
}
