import type { FormEvent } from 'react';
import { AppIcon } from '../app-shared';

type ChatComposerProps = {
  text: string;
  onTextChange: (text: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  enabled: boolean;
  sending: boolean;
};

/** The same text composer is used for family and private channels. */
export function ChatComposer({ text, onTextChange, onSubmit, enabled, sending }: ChatComposerProps) {
  return (
    <form className="chat-compose chat-composer" onSubmit={onSubmit} aria-label="Napisz wiadomość">
      <label className="chat-composer-field">
        <span className="chat-sr-only">Treść wiadomości</span>
        <input
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          placeholder={enabled ? 'Napisz wiadomość…' : 'Najpierw wybierz rozmowę'}
          maxLength={4000}
          disabled={!enabled || sending}
          autoComplete="off"
          enterKeyHint="send"
        />
      </label>
      <button
        className="chat-emoji-button"
        type="button"
        aria-label="Dodaj uśmiech do wiadomości"
        disabled={!enabled || sending}
        onClick={() => onTextChange(`${text} 😊`.slice(0, 4000))}
      >😊</button>
      <button
        className="primary-button chat-send-button"
        type="submit"
        disabled={!enabled || sending || !text.trim() || !navigator.onLine}
      ><AppIcon page="Czat" /><span>{sending ? 'Wysyłanie…' : 'Wyślij'}</span></button>
    </form>
  );
}
