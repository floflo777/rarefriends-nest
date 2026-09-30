import type { Input } from "../screens/machine.js";

export function Buttons({ onPress }: { onPress: (input: Input) => void }) {
  return (
    <div className="buttons" role="group" aria-label="Device buttons">
      <button type="button" className="btn btn-side" aria-label="Left" onClick={() => onPress("left")}>
        <span aria-hidden="true">&#9668;</span>
      </button>
      <button type="button" className="btn btn-ok" aria-label="OK" onClick={() => onPress("ok")}>
        <span aria-hidden="true">&#9679;</span>
      </button>
      <button type="button" className="btn btn-side" aria-label="Right" onClick={() => onPress("right")}>
        <span aria-hidden="true">&#9658;</span>
      </button>
    </div>
  );
}
