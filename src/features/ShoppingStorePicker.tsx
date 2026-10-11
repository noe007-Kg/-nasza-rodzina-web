import type { ShoppingStore } from './shopping-stores';

export function ShoppingStorePicker({ stores, value, onChange, legend = 'Sklepy (opcjonalnie)' }: {
  stores: readonly ShoppingStore[];
  value: readonly string[];
  onChange: (value: string[]) => void;
  legend?: string;
}) {
  return <fieldset className="shopping-store-picker">
    <legend>{legend}</legend>
    <div>{stores.filter(store => !store.archived).map(store => <label key={store.id}>
      <input type="checkbox" checked={value.includes(store.id)} disabled={!value.includes(store.id) && value.length >= 20} onChange={event => onChange(event.target.checked
        ? [...value.filter(id => id !== store.id), store.id].slice(0, 20) : value.filter(id => id !== store.id))}/>
      <span>{store.name}</span>
    </label>)}</div>
    {value.length === 0 && <small>Bez przypisania — produkt pozostaje na wspólnej liście.</small>}
    {value.length >= 20 && <small>Możesz wskazać maksymalnie 20 sklepów.</small>}
  </fieldset>;
}
