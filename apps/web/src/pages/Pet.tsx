import { Link, useParams } from "react-router-dom";
import { useDataSource } from "../data/context.jsx";
import { collectionFromSlug, parseTokenId } from "../data/source.js";
import { Device } from "../device/Device.jsx";

export function PetPage() {
  const { collection: slug, tokenId: rawId } = useParams();
  const collection = collectionFromSlug(slug);
  const tokenId = parseTokenId(rawId);
  const source = useDataSource();
  if (!collection || tokenId === null) {
    return (
      <main className="page">
        <p className="error">Unknown Friend: use /pet/gen/&lt;id&gt; or /pet/genesis/&lt;id&gt;.</p>
        <Link to="/">Home</Link>
      </main>
    );
  }
  return (
    <main className="page">
      <Device
        source={source}
        mode="visitor"
        target={{ kind: "friend", collection, tokenId }}
        footer={
          <nav className="under">
            <Link to="/">Home</Link>
            <Link to={`/card/${slug}/${rawId}`}>Pet card</Link>
          </nav>
        }
      />
    </main>
  );
}
