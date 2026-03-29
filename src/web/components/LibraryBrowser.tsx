import { BrowseItem, Library } from '../../shared/types';

interface LibraryBrowserProps {
  libraries: Library[];
  items: BrowseItem[];
  currentParentId?: string;
  isLoading: boolean;
  onOpenParent: (parentId?: string) => void;
  onSelectItem: (item: BrowseItem) => void;
}

export function LibraryBrowser({
  libraries,
  items,
  currentParentId,
  isLoading,
  onOpenParent,
  onSelectItem
}: LibraryBrowserProps) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Library</p>
          <h2>Jellyfin Browser</h2>
        </div>
        <button className="ghost-button" onClick={() => onOpenParent(undefined)} type="button">
          Root
        </button>
      </div>

      {!currentParentId && libraries.length > 0 ? (
        <div className="library-list">
          {libraries.map((library) => (
            <button
              key={library.id}
              className="list-button"
              onClick={() => onOpenParent(library.id)}
              type="button"
            >
              {library.name}
            </button>
          ))}
        </div>
      ) : null}

      {currentParentId ? (
        <div className="library-list">
          <button className="ghost-button" onClick={() => onOpenParent(undefined)} type="button">
            Back to libraries
          </button>
          {isLoading ? <p>Loading items...</p> : null}
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
          {!isLoading && items.length === 0 ? <p>No items found for this folder.</p> : null}
        </div>
      ) : null}
    </section>
  );
}
