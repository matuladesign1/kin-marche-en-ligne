'use client';

/** Case « tout cocher » pour les opérations de la file d'export. */
export function SelectAll({ name = 'ids' }: { name?: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Tout cocher"
      onChange={(e) => {
        const { checked, form } = e.currentTarget;
        form?.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${name}"]`).forEach((c) => { c.checked = checked; });
      }}
    />
  );
}
