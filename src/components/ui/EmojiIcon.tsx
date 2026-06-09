import { useSettingsStore } from '../../store/useSettingsStore';

const TWEMOJI_BASE = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg/';

export function emojiToTwemojiUrl(emoji: string): string {
  const codepoints = [...emoji]
    .map(c => c.codePointAt(0)!.toString(16).padStart(4, '0'))
    .filter(cp => cp !== 'fe0f'); // strip variation selector-16
  return `${TWEMOJI_BASE}${codepoints.join('-')}.svg`;
}

const PENGUIN_URL = emojiToTwemojiUrl('🐧');

interface EmojiIconProps {
  emoji: string;
  className?: string;
  alt?: string;
}

export function EmojiIcon({ emoji, className = 'w-5 h-5 inline-block', alt }: EmojiIconProps) {
  const penguinMode = useSettingsStore(s => (s.appSettings as any).penguinMode);
  const url = penguinMode ? PENGUIN_URL : emojiToTwemojiUrl(emoji);
  return (
    <img
      src={url}
      alt={alt ?? emoji}
      className={className}
      draggable={false}
      onError={e => { (e.target as HTMLImageElement).replaceWith(document.createTextNode(penguinMode ? '🐧' : emoji)); }}
    />
  );
}
