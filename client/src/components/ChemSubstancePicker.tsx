export interface PickedSubstance {
  productId: number | null;
  name: string;
  display?: string;
  cas: string | null;
  un: string | null;
  group: number | null;
}

export function ChemSubstancePicker({ label, labelEn, placeholder = "手工填写货名", value, onSelect }: {
  label?: string;
  labelEn?: string;
  placeholder?: string;
  value: PickedSubstance | null;
  onSelect: (s: PickedSubstance | null) => void;
  exclude?: number;
}) {
  return <label className="ssearch">
    {label && <span className="ssearch-lbl">{label} {labelEn}</span>}
    <input aria-label={label || placeholder} defaultValue={value?.name ?? ""} placeholder={placeholder}
      onChange={event => {
        const name = event.target.value;
        onSelect({ name, display: name, productId: null, group: null, cas: null, un: null });
      }} />
  </label>;
}
