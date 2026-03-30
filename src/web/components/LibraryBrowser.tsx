import { BrowseItem, Library } from '../../shared/types';

interface LibraryBrowserProps {
  activeMediaTitle: string | null;
  libraries: Library[];
  items: BrowseItem[];
  currentParentId?: string;
  hasActiveSession: boolean;
  isLoading: boolean;
  onOpenParent: (parentId?: string) => void;
  onSelectItem: (item: BrowseItem) => void;
}

export function LibraryBrowser({
  activeMediaTitle,
  libraries,
  items,
  currentParentId,
  hasActiveSession,
  isLoading,
  onOpenParent,
  onSelectItem
}: LibraryBrowserProps) {
  return (
    <section className={`panel browser-panel${hasActiveSession ? ' is-secondary' : ''}`}>
      <div className="panel-header">
        <div>
          <p className="eyebrow">Browse</p>
          <h2>Jellyfin library</h2>
        </div>
        <button className="ghost-button" onClick={() => onOpenParent(undefined)} type="button">
          Root
        </button>
      </div>

      <p className="browser-copy">
        Open a media item with an editable sidecar subtitle, then continue in the alignment workflow.
      </p>

      {activeMediaTitle ? (
        <div className="browser-note">
          <span className="cue-label">Active session</span>
          <strong>{activeMediaTitle}</strong>
        </div>
      ) : null}

      {!currentParentId && libraries.length > 0 ? (
        <div className="library-list">
          {libraries.map((library) => (
            <button
              key={library.id}
              className="list-button"
              onClick={() => onOpenParent(library.id)}
              type="button"
            >
              <span>{library.name}</span>
              <span className="type-pill">library</span>
            </button>
          ))}
        </div>
      ) : null}

      {currentParentId ? (
        <div className="library-list">
          <button className="ghost-button" onClick={() => onOpenParent(undefined)} type="button">
            Back to libraries
          </button>
          {isLoading ? <p className="empty-note">Loading items…</p> : null}
          {items.map((item) => (
            <button
              key={item.id}
              className="list-button"
              onClick={() => onSelectItem(item)}
              type="button"
            >
              <span>{item.title}</span>
              <span className="type-pill">{item.type}</span>
            </button>
          ))}
          {!isLoading && items.length === 0 ? <p className="empty-note">No items found for this folder.</p> : null}
        </div>
      ) : null}
    </section>
  );
}
