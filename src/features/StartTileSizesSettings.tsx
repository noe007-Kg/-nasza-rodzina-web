import { useId } from 'react';
import { START_CARD_IDS, type StartCardId } from './start-layout';
import { START_TILE_SIZE_OPTIONS, selectedStartTileSize, type StartTileSize } from './start-tile-sizes';
import { useStartTileSizes } from './useStartTileSizes';
import './start-tile-sizes.css';

const LABELS: Record<StartCardId, string> = { 'family-time': 'Rodzinny czas', calendar: 'Kalendarz', tasks: 'Zadania', shopping: 'Zakupy', chat: 'Czat', health: 'Zdrowie', school: 'Szkoła' };

export function StartTileSizesSettings({ uid }: { uid: string }) {
  const idPrefix = useId();
  const { sizes, setSize, resetSizes, storageMessage } = useStartTileSizes(uid);
  return <details className="start-tile-sizes-settings" data-testid="start-tile-sizes-settings">
    <summary>Rozmiary kafelków</summary>
    <p className="settings-footnote">Automatyczny dopasowuje wysokość do zawartości. Rozmiary zapisują się tylko na tym urządzeniu, osobno dla Twojego konta.</p>
    <div className="start-tile-size-rows">{START_CARD_IDS.map(cardId => <div className="start-tile-size-row" key={cardId}>
      <label htmlFor={`${idPrefix}-${cardId}`}>{LABELS[cardId]}</label>
      <select id={`${idPrefix}-${cardId}`} value={selectedStartTileSize(sizes, cardId)} onChange={event => setSize(cardId, event.target.value as StartTileSize)}>
        {START_TILE_SIZE_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </div>)}</div>
    <button type="button" className="secondary-button start-tile-size-reset" onClick={resetSizes}>Przywróć automatyczne rozmiary</button>
    {storageMessage && <p className="settings-footnote" role="status">{storageMessage}</p>}
  </details>;
}
