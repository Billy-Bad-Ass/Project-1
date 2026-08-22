/**
 * Structured data emitter. Next injects this into the page body; search
 * engines accept JSON-LD anywhere in the document.
 */
export function JsonLd({ data }: { data: Record<string, unknown> | null }) {
  if (!data) return null;
  return (
    <script
      type="application/ld+json"
      // Escaping `<` prevents a string inside the data from closing the script
      // tag early. Item titles come from third-party APIs, so this is reachable.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, '\\u003c'),
      }}
    />
  );
}

export default JsonLd;
