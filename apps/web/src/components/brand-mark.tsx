export function BrandMark({ name, logoUrl, size = 40 }: { name: string; logoUrl?: string | null; size?: number }) {
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl} alt={`${name} logo`} style={{ width: size, height: size }} className="rounded-xl object-contain" />;
  }
  return (
    <span className="bg-brand-gradient grid shrink-0 place-items-center rounded-xl font-display font-bold text-white shadow-md" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden>
      FG
    </span>
  );
}
