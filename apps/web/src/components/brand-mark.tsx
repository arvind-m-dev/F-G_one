export function BrandMark({ name, logoUrl, size = 40 }: { name: string; logoUrl?: string | null; size?: number }) {
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl} alt={`${name} logo`} style={{ width: size, height: size }} className="rounded-xl object-contain" />;
  }
  return (
    <span className="bg-brand-gradient grid shrink-0 place-items-center rounded-lg font-semibold tracking-tight text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_1px_2px_rgb(0_0_0/0.15)]" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden>
      FG
    </span>
  );
}
