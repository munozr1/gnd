/** Left-dock library for the schematic tab. */
import { LibraryList, startPlacing } from './LibraryList';

export function LibraryPanel() {
  return <LibraryList onPick={startPlacing} />;
}
