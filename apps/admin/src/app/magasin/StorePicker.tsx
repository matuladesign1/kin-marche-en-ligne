export function StorePicker({ stores, current, path }: { stores: { id: string; name: string }[]; current: string; path: string }) {
  if (stores.length < 2) return null;
  return (
    <form action={path} className="row" style={{ marginBottom: 12 }}>
      <label>Magasin
        <select name="store" defaultValue={current}>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      </label>
      <button className="secondary">Afficher</button>
    </form>
  );
}
