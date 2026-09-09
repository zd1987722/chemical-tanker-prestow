import { Fragment, type ReactNode } from "react";

export function KvList({
  items,
  className,
}: {
  items: { label: string; value: ReactNode }[];
  className?: string;
}) {
  return (
    <dl className={className ? `kv ${className}` : "kv"}>
      {items.map((item, index) => (
        <Fragment key={`${item.label}-${index}`}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
