import { Route, Routes } from 'react-router-dom';
import type { DocKind } from '@shared/types';
import { DocListPage, DocListPane } from './DocList';
import { DocForm } from './DocForm';
import { DocDetail } from './DocDetail';

/** Routes for one document module: list, new, split-view detail and edit. */
export default function DocModule({ kind }: { kind: DocKind }) {
  return (
    <Routes>
      <Route index element={<DocListPage kind={kind} />} />
      <Route path="new" element={<DocForm key={`new-${kind}`} kind={kind} />} />
      <Route path=":id/edit" element={<DocForm kind={kind} />} />
      <Route
        path=":id"
        element={
          <div className="flex h-full">
            <DocListPane kind={kind} />
            <DocDetail kind={kind} />
          </div>
        }
      />
    </Routes>
  );
}
