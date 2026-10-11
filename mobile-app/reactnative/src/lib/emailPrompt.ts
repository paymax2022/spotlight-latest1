// Promise-based "enter your email" prompt, usable from anywhere (a hook, an API
// helper) while <EmailPromptHost/> — mounted once at the app root — renders it.
// Same shape as src/lib/confirm.ts. A text field cannot be done with Alert.alert
// on Android/web, so unlike confirmAsync this renders the in-app modal on every
// platform. No react-native import here, so the store is unit-testable.

export interface EmailPromptOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  /** Prefill, e.g. an address the user already typed. */
  initialValue?: string;
}

export interface EmailPromptRequest {
  id: number;
  title: string;
  message?: string;
  confirmLabel: string;
  initialValue: string;
  resolve: (value: string | null) => void;
}

let listener: ((queue: EmailPromptRequest[]) => void) | null = null;
let queue: EmailPromptRequest[] = [];
let seq = 0;

/** Subscribe the host to pending prompts. Returns an unsubscribe function. */
export function subscribeEmailPrompt(fn: (queue: EmailPromptRequest[]) => void): () => void {
  listener = fn;
  fn(queue);
  return () => {
    if (listener === fn) listener = null;
  };
}

/** Called by the host: the entered address, or null if the user cancelled. */
export function resolveEmailPrompt(id: number, value: string | null): void {
  const req = queue.find((r) => r.id === id);
  queue = queue.filter((r) => r.id !== id);
  listener?.(queue);
  req?.resolve(value);
}

/**
 * Ask the user for an email address. Resolves with the (already validated by the
 * host) address, or `null` if they cancel. Resolves `null` straight away when no
 * host is mounted, so a caller can never hang on a prompt nobody will show.
 */
export function promptEmailAsync(opts: EmailPromptOptions): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    if (!listener) {
      resolve(null);
      return;
    }
    const id = ++seq;
    queue = [
      ...queue,
      {
        id,
        title: opts.title,
        message: opts.message,
        confirmLabel: opts.confirmLabel ?? 'Continue',
        initialValue: opts.initialValue ?? '',
        resolve,
      },
    ];
    listener(queue);
  });
}
