import { useId, useState } from 'react';
import { AppIcon } from '../app-shared';
import type { Page } from '../app-shared';
import { START_CARD_IDS, type StartCardId } from './start-layout';
import { START_TILE_COLOR_PALETTE, type StartTileColorChoice } from './start-tile-colors';
import { useStartTileColors } from './useStartTileColors';
import { Icon } from '../ui';

const TILE_NAMES: Record<StartCardId, { name: string; page: Page }> = {
  'family-time': { name: 'Rodzinny czas', page: 'Rodzina' },
  calendar: { name: 'Kalendarz', page: 'Kalendarz' },
  tasks: { name: 'Zadania', page: 'Zadania' },
  shopping: { name: 'Zakupy', page: 'Zakupy' },
  chat: { name: 'Czat', page: 'Czat' },
  health: { name: 'Zdrowie', page: 'Zdrowie' },
  school: { name: 'Szkoła', page: 'Szkoła' },
};

export function StartTileColorsSettings({ uid }: { uid: string }) {
  const { colors, setColor, resetColors, storageMessage } = useStartTileColors(uid);
  const groupId = useId();
  const [expanded, setExpanded] = useState(false);
  function choice(cardId: StartCardId, colorId: StartTileColorChoice, label: string, background?: string) {
    const selected = (colors[cardId] || 'original') === colorId;
    return <label className={`start-color-choice${selected ? ' is-selected' : ''}`} key={colorId} title={label}>
      <input type="radio" name={`${groupId}-${cardId}`} value={colorId} checked={selected}
        aria-label={`${TILE_NAMES[cardId].name}: ${label}`} onChange={() => setColor(cardId, colorId)} />
      <span aria-hidden="true" className={`start-color-dot${colorId === 'original' ? ' is-original' : ''}`} style={background ? { backgroundColor: background } : undefined}/>
    </label>;
  }
  function customChoice(cardId: StartCardId) {
    const current = colors[cardId];
    const selected = !!current?.startsWith('#');
    const background = selected ? current : '#ff2fa8';
    return <label className={`start-color-choice start-color-custom${selected ? ' is-selected' : ''}`} title="Wybierz dowolny kolor">
      <input type="color" value={background} aria-label={`${TILE_NAMES[cardId].name}: Multikolor`}
        onInput={event => setColor(cardId, event.currentTarget.value as `#${string}`)}
        onChange={event => setColor(cardId, event.currentTarget.value as `#${string}`)} />
      <span aria-hidden="true" className={`start-color-dot${selected ? '' : ' is-multicolor'}`} style={selected ? { backgroundColor: background } : undefined}/>
      <span aria-hidden="true">Multikolor</span>
    </label>;
  }
  return <div className="start-tile-color-settings" data-testid="tile-color-settings">
    <button type="button" className="start-colors-disclosure" aria-expanded={expanded} aria-controls={`${groupId}-colors`}
      onClick={() => setExpanded(value => !value)}><strong>Kolory kafelków</strong><Icon name="chevron-right" size={16}/></button>
    <div id={`${groupId}-colors`} hidden={!expanded} className="start-colors-content">
    <p className="start-color-note">Każdy kafelek może mieć własny kolor. Kolory zapisują się osobno dla Twojego konta na tym urządzeniu i nie synchronizują się między urządzeniami.</p>
    <span className="start-color-original-hint"><span aria-hidden="true">🌈</span> Pierwsze kółeczko: Oryginalny · Ostatnie: Multikolor</span>
    <div className="start-color-rows">
      {START_CARD_IDS.map(cardId => <fieldset className="start-color-row" key={cardId} data-testid={`tile-color-row-${cardId}`}>
        <legend><AppIcon page={TILE_NAMES[cardId].page} size={18}/><span>{TILE_NAMES[cardId].name}</span></legend>
        <div className="start-color-options">
          {choice(cardId, 'original', 'Oryginalny')}
          {START_TILE_COLOR_PALETTE.map(color => choice(cardId, color.id, color.label, color.background))}
          {customChoice(cardId)}
        </div>
      </fieldset>)}
    </div>
    <button className="start-colors-reset" type="button" onClick={resetColors}>Przywróć domyślne kolory</button>
    {storageMessage && <p className="start-color-storage-warning" role="status">{storageMessage}</p>}
    </div>
  </div>;
}
