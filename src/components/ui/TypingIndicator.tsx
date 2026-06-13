export const TypingIndicator = () => (
  <div className="flex items-center gap-1.5 px-4 py-3 bg-panel-2 rounded-2xl w-fit shadow-sm border border-edge animate-in fade-in zoom-in duration-300">
    {[0, 200, 400].map(delay => <div key={delay} className="w-1.5 h-1.5 bg-accent rounded-full" style={{ animation: `typingBounce 1.4s infinite ${delay}ms` }} />)}
  </div>
);
