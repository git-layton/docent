export const TypingIndicator = () => (
  <div className="flex items-center gap-1.5 px-4 py-3 bg-neutral-100 dark:bg-neutral-800 rounded-2xl w-fit shadow-sm border border-neutral-200/50 dark:border-neutral-700/50 animate-in fade-in zoom-in duration-300">
    {[0, 200, 400].map(delay => <div key={delay} className="w-1.5 h-1.5 bg-neutral-400 dark:bg-neutral-500 rounded-full" style={{ animation: `typingBounce 1.4s infinite ${delay}ms` }} />)}
  </div>
);
